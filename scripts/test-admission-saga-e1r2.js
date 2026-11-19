'use strict';

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');

if (process.env.NODE_ENV && process.env.NODE_ENV !== 'test') {
  throw new Error('Refusing E1-R2 saga tests unless NODE_ENV is test.');
}
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://127.0.0.1';
process.env.TRUST_PROXY_HOPS = '0';
process.env.REDIS_URL = '';
process.env.EMAIL_TRANSPORT = 'json';
process.env.FRONTEND_URL = 'http://127.0.0.1';
process.env.JWT_SECRET = 'synthetic-e1r2-admission-jwt-secret-only';
process.env.JWT_EXPIRE = '5m';
process.env.EMAIL_ENCRYPTION_KEY_VERSION = 'e1r2-admission-test';
process.env.EMAIL_ENCRYPTION_KEY = crypto.createHash('sha256')
  .update('synthetic-e1r2-admission-key-only').digest('base64');

const mongoUri = process.env.MONGO_TEST_URI;
assert(mongoUri, 'MONGO_TEST_URI is required; refusing implicit MongoDB selection');
assert.strictEqual(process.env.ALLOW_E1R2_TEST_WRITES, '1', 'Set ALLOW_E1R2_TEST_WRITES=1 to authorize isolated test writes');
const parsedMongoUri = new URL(mongoUri);
const databaseName = parsedMongoUri.pathname.replace(/^\/+/, '');
assert(['localhost', '127.0.0.1', '::1'].includes(parsedMongoUri.hostname), 'MongoDB tests only permit localhost');
assert(/^erp_security_e1r2_[A-Za-z0-9_-]+$/.test(databaseName), 'Mongo database must be named erp_security_e1r2_*');

const mongoose = require('mongoose');
require('express-async-errors');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Admission = require('../models/Admission');
const AdmissionSagaAttempt = require('../models/AdmissionSagaAttempt');
const EmailDelivery = require('../models/EmailDelivery');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const StudentFee = require('../models/StudentFee');
const FeeStructure = require('../models/FeeStructure');
const AcademicYear = require('../models/AcademicYear');
const authService = require('../services/auth.service');
const admissionService = require('../services/admission.service');
const {
  acquireReconciliationLeaseForTests,
  reconcileDeliveries,
} = require('../services/email-delivery.service');
const admissionRoutes = require('../routes/admission.routes');

const runId = process.env.E1R2_TEST_RUN_ID || crypto.randomBytes(8).toString('hex');
assert(/^[A-Za-z0-9_-]{4,40}$/.test(runId), 'E1R2_TEST_RUN_ID must be 4-40 safe characters');
const admissionIds = [];
const fixtureUserIds = [];
const fixtureParentProfileIds = [];
let feeStructureId;
let academicYearRecord;
let server;
let queryBarrierRestore;

async function createAdmission(label, overrides = {}) {
  const admission = await Admission.create({
    applicationNumber: `E1R2-${runId}-${label}`,
    studentName: `Synthetic E1R2 ${runId} ${label}`,
    dateOfBirth: new Date('2014-01-01'),
    classApplyingFor: overrides.classApplyingFor || '5',
    fatherName: 'Synthetic Parent',
    fatherEmail: `e1r2-parent-${runId}-${label}@example.com`,
    fatherPhone: '+91 9876543210',
    status: 'Approved',
    enrollmentEffectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    enrollmentAcademicYear: '2026-2027',
    ...overrides,
  });
  admissionIds.push(admission._id);
  return admission;
}

async function createUser(label, options = {}) {
  const user = await User.create({
    name: `Synthetic E1R2 ${runId} ${label}`,
    email: `e1r2-${runId}-${label}@example.com`,
    password: 'Synthetic-E1R2-Password-2026!',
    role: options.role || 'student',
    isActive: options.isActive !== undefined ? options.isActive : true,
    isEmailVerified: options.isEmailVerified !== undefined ? options.isEmailVerified : true,
  });
  fixtureUserIds.push(user._id);
  return user;
}

function request(port, method, path, payload, token) {
  const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}),
        ...(token ? { Cookie: `token=${token}` } : {}),
      },
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(responseBody) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function installReadBarrier(matches) {
  const original = User.findOne;
  let reads = 0;
  let release;
  const bothRead = new Promise((resolve) => { release = resolve; });
  User.findOne = function (...args) {
    const query = original.apply(this, args);
    if (!matches(args[0])) return query;
    const exec = query.exec.bind(query);
    query.exec = async (...execArgs) => {
      const result = await exec(...execArgs);
      reads += 1;
      if (reads === 2) release();
      await bothRead;
      return result;
    };
    return query;
  };
  queryBarrierRestore = () => { User.findOne = original; };
}

async function assertRolledBack(admissionId, point) {
  const admission = await Admission.findById(admissionId).lean();
  assert.strictEqual(admission.status, 'Approved', `${point}: saga should restore Approved`);
  assert.strictEqual(admission.admissionSaga.state, 'rolled_back', `${point}: recovery should record rollback`);
  const resources = admission.admissionSaga.resources;
  assert.strictEqual(await User.exists({ _id: resources.studentUserId }), null, `${point}: student user should be removed`);
  assert.strictEqual(await Student.exists({ _id: resources.studentId }), null, `${point}: student should be removed`);
  assert.strictEqual(await StudentFee.exists({ _id: resources.studentFeeId }), null, `${point}: fee should be removed`);
  const deliveries = await EmailDelivery.find({ relatedAdmission: admissionId }).lean();
  assert(deliveries.every((row) => row.status === 'expired' && !row.encryptedToken),
    `${point}: saga deliveries must be expired and erased`);
  const linkedParent = await Parent.exists({ children: resources.studentId });
  assert.strictEqual(linkedParent, null, `${point}: parent child link should be removed`);
}

async function testCommitBoundary() {
  const officer = await createUser('officer', { role: 'admission_officer' });
  const serviceCreated = await admissionService.applyForAdmission({
    applicationNumber: `FORGED-${runId}`,
    studentName: `Synthetic E1R2 ${runId} service-create`,
    dateOfBirth: new Date('2014-01-01'),
    classApplyingFor: '5',
    status: 'Admitted',
    createdStudent: new mongoose.Types.ObjectId(),
    admissionSaga: { id: 'forged', state: 'committed', commitMarker: 'forged' },
  });
  admissionIds.push(serviceCreated._id);
  assert.strictEqual(serviceCreated.status, 'Submitted', 'service creation must force the initial status');
  assert.strictEqual(serviceCreated.createdStudent, undefined, 'service creation must ignore saga-owned student IDs');
  assert.strictEqual(serviceCreated.admissionSaga, undefined, 'service creation must ignore caller saga markers');

  const publicCreateBypass = await request(server.address().port, 'POST', '/api/v1/admissions/apply', {
    studentName: `Synthetic E1R2 ${runId} public-create`,
    dateOfBirth: '2014-01-01',
    classApplyingFor: '5',
    status: 'Admitted',
    admissionSaga: { id: 'forged', state: 'committed', commitMarker: 'forged' },
  });
  assert.strictEqual(publicCreateBypass.status, 422, 'public application route must reject caller workflow fields');

  const admission = await createAdmission('commit-boundary');
  const token = jwt.sign({ id: officer._id, tokenVersion: officer.tokenVersion || 0 }, process.env.JWT_SECRET);
  const statusResponse = await request(server.address().port, 'PUT',
    `/api/v1/admissions/${admission._id}/status`, { status: 'Admitted' }, token);
  assert.strictEqual(statusResponse.status, 400, 'officer status route must reject direct Admitted transition');
  const updateResponse = await request(server.address().port, 'PUT',
    `/api/v1/admissions/${admission._id}`, { status: 'Admitted', createdStudent: new mongoose.Types.ObjectId() }, token);
  assert.strictEqual(updateResponse.status, 400, 'officer update route must reject saga-owned fields');
  await assert.rejects(admissionService.updateAdmissionStatus(admission._id, 'Admitted'),
    (error) => error.statusCode === 400);
  await assert.rejects(admissionService.updateAdmission(admission._id, { admissionSaga: { state: 'committed' } }),
    (error) => error.statusCode === 400);
  await assert.rejects(admissionService.updateAdmissionStatus(admission._id, 'Unknown'),
    (error) => error.statusCode === 400);

  const legitimate = await request(server.address().port, 'POST',
    `/api/v1/admissions/${admission._id}/admit`, undefined, token);
  assert.strictEqual(legitimate.status, 200, 'authorized saga route should complete admission');
  const saved = await Admission.findById(admission._id).lean();
  assert.strictEqual(saved.status, 'Admitted');
  assert.strictEqual(saved.admissionSaga.state, 'committed');
  assert.strictEqual(saved.admissionSaga.commitMarker, `${saved.admissionSaga.id}:${saved.admissionSaga.ownerGeneration}`);
}

async function testReconciliationLeaseContention() {
  const contenders = await Promise.all([
    acquireReconciliationLeaseForTests(),
    acquireReconciliationLeaseForTests(),
  ]);
  assert.strictEqual(contenders.filter(Boolean).length, 1,
    'only one reconciler may own the Mongo lease at a time');
  const lease = contenders.find(Boolean);
  try {
    await lease.assertOwned();
  } finally {
    await lease.release();
  }
}

async function testCrashRecoveryAtEachPersistedStage() {
  const crashPoints = [
    'after:claimed',
    'checkpoint:counter_allocated',
    'after:student_user_write',
    'after:parent_user_write',
    'after:parent_profile_write',
    'after:student_write',
    'after:parent_link_write',
    'after:student_fee_write',
    'after:student_activation_token_persist',
    'after:student_delivery_write',
    'after:parent_activation_token_persist',
    'after:parent_delivery_write',
  ];
  for (let index = 0; index < crashPoints.length; index += 1) {
    const point = crashPoints[index];
    const admission = await createAdmission(`crash-${index}`);
    admissionService.setSagaTestHook(async (actual) => {
      if (actual === point) throw Object.assign(new Error('synthetic process stop'), { simulateSagaCrash: true });
    });
    try {
      await assert.rejects(admissionService.admitStudent(admission._id), (error) => error.simulateSagaCrash === true);
    } finally {
      admissionService.setSagaTestHook(null);
    }
    await AdmissionSagaAttempt.updateOne({ admission: admission._id }, { $set: { leaseUntil: new Date(0) } });
    await Admission.updateOne({ _id: admission._id }, { $set: { 'admissionSaga.leaseUntil': new Date(0) } });
    await admissionService.recoverStaleAdmissionSagas();
    await assertRolledBack(admission._id, point);
  }

  const postCommitCrash = await createAdmission('crash-after-commit');
  admissionService.setSagaTestHook(async (point) => {
    if (point === 'after:commit_boundary') throw Object.assign(new Error('synthetic process stop'), { simulateSagaCrash: true });
  });
  try {
    await assert.rejects(admissionService.admitStudent(postCommitCrash._id),
      (error) => error.simulateSagaCrash === true);
  } finally {
    admissionService.setSagaTestHook(null);
  }
  await admissionService.recoverStaleAdmissionSagas();
  await reconcileDeliveries();
  const committed = await Admission.findById(postCommitCrash._id).lean();
  assert.strictEqual(committed.admissionSaga.state, 'committed', 'recovery must preserve committed saga');
  const committedDeliveries = await EmailDelivery.find({ relatedAdmission: postCommitCrash._id }).lean();
  assert(committedDeliveries.length > 0);
  assert(committedDeliveries.every((row) => row.status === 'pending'), 'committed staged deliveries should be released');
}

async function testCompensationFailureNeedsManualReview() {
  const admission = await createAdmission('compensation-failure');
  admissionService.setSagaTestHook(async (point) => {
    if (point === 'after:student_user_write') throw Object.assign(new Error('synthetic process stop'), { simulateSagaCrash: true });
  });
  try {
    await assert.rejects(admissionService.admitStudent(admission._id), (error) => error.simulateSagaCrash === true);
  } finally {
    admissionService.setSagaTestHook(null);
  }
  const planned = await Admission.findById(admission._id).select('admissionSaga.resources').lean();
  await AdmissionSagaAttempt.updateOne({ admission: admission._id }, { $set: { leaseUntil: new Date(0) } });
  await Admission.updateOne({ _id: admission._id }, { $set: { 'admissionSaga.leaseUntil': new Date(0) } });
  const originalDeleteOne = User.deleteOne;
  User.deleteOne = async function (filter, ...args) {
    if (String(filter && filter._id) === String(planned.admissionSaga.resources.studentUserId)) {
      throw new Error('synthetic compensation outage');
    }
    return originalDeleteOne.call(this, filter, ...args);
  };
  try {
    await admissionService.recoverStaleAdmissionSagas();
  } finally {
    User.deleteOne = originalDeleteOne;
  }
  const saved = await Admission.findById(admission._id).lean();
  assert.strictEqual(saved.admissionSaga.state, 'manual_review');
  assert.strictEqual(saved.status, 'Admitting', 'failed compensation must not make the admission retryable');
  assert(await User.exists({ _id: planned.admissionSaga.resources.studentUserId }));
}

async function testStudentFeeCreateFailureCompensates() {
  const admission = await createAdmission('student-fee-create-failure', { classApplyingFor: '5' });
  const originalCreate = StudentFee.create;
  StudentFee.create = async function (document, ...args) {
    if (document && document.class === '5') throw new Error('synthetic StudentFee.create failure');
    return originalCreate.call(this, document, ...args);
  };
  try {
    await assert.rejects(admissionService.admitStudent(admission._id), /synthetic StudentFee\.create failure/);
  } finally {
    StudentFee.create = originalCreate;
  }
  const saved = await Admission.findById(admission._id).lean();
  const resources = saved.admissionSaga.resources;
  assert.strictEqual(saved.status, 'Approved');
  assert.strictEqual(saved.admissionSaga.state, 'rolled_back');
  assert.strictEqual(await User.exists({ _id: resources.studentUserId }), null);
  assert.strictEqual(await Student.exists({ _id: resources.studentId }), null);
  assert.strictEqual(await StudentFee.exists({ _id: resources.studentFeeId }), null);
  assert.strictEqual(await EmailDelivery.exists({ relatedAdmission: admission._id }), null,
    'fee failure happens before activation delivery staging');
}

async function testReusedParentValidationAndActivation() {
  const wrongRole = await createUser('wrong-role-parent', { role: 'teacher' });
  const rejectedAdmission = await createAdmission('wrong-parent-role', { fatherEmail: wrongRole.email });
  await assert.rejects(admissionService.admitStudent(rejectedAdmission._id), (error) => error.statusCode === 409);
  assert(await User.exists({ _id: wrongRole._id }), 'non-parent account must not be deleted by compensation');
  assert.strictEqual((await Admission.findById(rejectedAdmission._id)).status, 'Approved');

  const inconsistentParent = await createUser('inconsistent-parent', {
    role: 'parent', isActive: true, isEmailVerified: false,
  });
  const inconsistentAdmission = await createAdmission('inconsistent-parent', { fatherEmail: inconsistentParent.email });
  await assert.rejects(admissionService.admitStudent(inconsistentAdmission._id), (error) => error.statusCode === 409);
  assert(await User.exists({ _id: inconsistentParent._id }), 'inconsistent reused account must be preserved');

  const inactiveParent = await createUser('inactive-parent', { role: 'parent', isActive: false, isEmailVerified: false });
  const inactiveParentProfile = await Parent.create({ user: inactiveParent._id, children: [], relationship: 'Father' });
  fixtureParentProfileIds.push(inactiveParentProfile._id);
  const admission = await createAdmission('inactive-parent', { fatherEmail: inactiveParent.email });
  const student = await admissionService.admitStudent(admission._id);
  const saved = await Admission.findById(admission._id).lean();
  assert.strictEqual(saved.admissionSaga.state, 'committed');
  const parentDelivery = await EmailDelivery.findOne({
    relatedAdmission: admission._id,
    admissionSagaId: saved.admissionSaga.id,
    user: inactiveParent._id,
    type: 'activation',
  }).lean();
  assert(parentDelivery, 'inactive reused parent should receive an activation delivery staged under this saga');
  assert(await Parent.exists({ _id: inactiveParentProfile._id, children: student._id }));
}

async function testConcurrentTokenIssuance() {
  const resetUser = await createUser('reset-race');
  const resetFilter = (filter) => filter && filter.email === resetUser.email;
  installReadBarrier(resetFilter);
  try {
    await Promise.all([
      authService.forgotPassword(resetUser.email),
      authService.forgotPassword(resetUser.email),
    ]);
  } finally {
    queryBarrierRestore();
    queryBarrierRestore = null;
  }
  const resetSaved = await User.findById(resetUser._id).lean();
  const resetDeliveries = await EmailDelivery.find({ user: resetUser._id, type: 'password_reset' }).lean();
  assert(resetSaved.resetPasswordToken);
  assert.strictEqual(resetDeliveries.length, 1, 'concurrent reset issuance must converge on one current delivery');
  const resetHash = resetSaved.resetPasswordToken;
  await authService.forgotPassword(resetUser.email);
  assert.strictEqual((await User.findById(resetUser._id)).resetPasswordToken, resetHash,
    'a repeat reset request must not invalidate the active link');

  const activationUser = await createUser('activation-race', { isActive: false, isEmailVerified: false });
  const activationFilter = (filter) => filter && String(filter._id) === String(activationUser._id) && filter.isActive;
  installReadBarrier(activationFilter);
  let results;
  try {
    results = await Promise.allSettled([
      authService.sendActivationEmail(activationUser),
      authService.sendActivationEmail(activationUser),
    ]);
  } finally {
    queryBarrierRestore();
    queryBarrierRestore = null;
  }
  assert.strictEqual(results.filter((result) => result.status === 'fulfilled').length, 1,
    'only one concurrent activation issuance should win the compare-and-set');
  const activationSaved = await User.findById(activationUser._id).lean();
  const activationDeliveries = await EmailDelivery.find({ user: activationUser._id, type: 'activation' }).lean();
  assert(activationSaved.activationToken);
  assert.strictEqual(activationDeliveries.length, 1);
}

async function cleanupFixtures() {
  if (mongoose.connection.readyState !== 1) return;
  const admissions = await Admission.find({ _id: { $in: admissionIds } }).select('admissionSaga').lean();
  const studentIds = [];
  const sagaUserIds = [];
  const createdParentProfileIds = [];
  const createdParentUserIds = [];
  const feeIds = [];
  for (const admission of admissions) {
    const resources = admission.admissionSaga && admission.admissionSaga.resources;
    if (!resources) continue;
    studentIds.push(resources.studentId);
    sagaUserIds.push(resources.studentUserId);
    feeIds.push(resources.studentFeeId);
    if (resources.parentProfileCreated && resources.parentProfileId) createdParentProfileIds.push(resources.parentProfileId);
    if (resources.parentUserCreated && resources.parentUserId) createdParentUserIds.push(resources.parentUserId);
  }
  if (studentIds.length) {
    await Parent.updateMany({ children: { $in: studentIds } }, { $pull: { children: { $in: studentIds } } }).catch(() => {});
    await StudentFee.deleteMany({ _id: { $in: feeIds } }).catch(() => {});
    await Student.deleteMany({ _id: { $in: studentIds } }).catch(() => {});
  }
  if (createdParentProfileIds.length || fixtureParentProfileIds.length) {
    await Parent.deleteMany({ _id: { $in: [...createdParentProfileIds, ...fixtureParentProfileIds] } }).catch(() => {});
  }
  await EmailDelivery.deleteMany({
    $or: [
      { relatedAdmission: { $in: admissionIds } },
      { user: { $in: [...fixtureUserIds, ...sagaUserIds, ...createdParentUserIds] } },
    ],
  }).catch(() => {});
  await User.deleteMany({ _id: { $in: [...fixtureUserIds, ...sagaUserIds, ...createdParentUserIds] } }).catch(() => {});
  await Admission.deleteMany({ _id: { $in: admissionIds } }).catch(() => {});
  if (feeStructureId) await FeeStructure.deleteOne({ _id: feeStructureId }).catch(() => {});
  if (academicYearRecord) await AcademicYear.deleteOne({ _id: academicYearRecord._id }).catch(() => {});
}

async function main() {
  await mongoose.connect(mongoUri);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/admissions', admissionRoutes);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });

  feeStructureId = (await FeeStructure.create({
    name: `Synthetic E1R2 ${runId} fee`,
    class: '5',
    academicYear: '2026-2027',
    components: [{ name: 'Synthetic tuition', amount: 100, type: 'Tuition' }],
    isActive: true,
  }))._id;

  academicYearRecord = await AcademicYear.create({
    name: '2026-2027',
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2027-03-31T23:59:59.999Z'),
    isCurrent: true,
    isActive: true,
  });

  await testCommitBoundary();
  await testReconciliationLeaseContention();
  await testCrashRecoveryAtEachPersistedStage();
  await testStudentFeeCreateFailureCompensates();
  await testCompensationFailureNeedsManualReview();
  await testReusedParentValidationAndActivation();
  await testConcurrentTokenIssuance();
  console.log('PASS E1-R2 guarded saga, recovery, commit-boundary, parent, and token-issuance checks');
}

main().catch((error) => {
  const message = String(error && error.message || 'E1-R2 admission saga test failed')
    .replace(/(?:mongodb(?:\+srv)?|rediss?):\/\/\S+/gi, '[connection URI]');
  console.error(message);
  process.exitCode = 1;
}).finally(async () => {
  admissionService.setSagaTestHook(null);
  if (queryBarrierRestore) queryBarrierRestore();
  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    await cleanupFixtures();
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
  }
});
