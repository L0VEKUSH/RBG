'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { fork } = require('child_process');

if (process.env.NODE_ENV && process.env.NODE_ENV !== 'test') {
  throw new Error('Refusing E1-R3 integration tests unless NODE_ENV=test.');
}
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = '';
process.env.EMAIL_TRANSPORT = 'json';
process.env.FRONTEND_URL = 'http://127.0.0.1';
process.env.ADMISSION_SAGA_LEASE_MS = '60000';
process.env.ADMISSION_SAGA_ORPHAN_RECHECK_MS = '60000';
process.env.EMAIL_ENCRYPTION_KEY_VERSION = 'e1r3-test';
process.env.EMAIL_ENCRYPTION_KEY = crypto.createHash('sha256')
  .update('synthetic-e1r3-admission-encryption-key').digest('base64');

const mongoUri = process.env.MONGO_TEST_URI;
assert(mongoUri, 'MONGO_TEST_URI is required; refusing implicit MongoDB selection');
assert.strictEqual(process.env.ALLOW_E1R3_TEST_WRITES, '1', 'Set ALLOW_E1R3_TEST_WRITES=1 to authorize isolated test writes');
const parsedMongoUri = new URL(mongoUri);
const databaseName = parsedMongoUri.pathname.replace(/^\/+/, '');
assert(['localhost', '127.0.0.1', '::1'].includes(parsedMongoUri.hostname), 'MongoDB tests only permit localhost');
assert(/^erp_security_e1r3_[A-Za-z0-9_-]+$/.test(databaseName), 'Mongo database must be named erp_security_e1r3_*');

const mongoose = require('mongoose');
const Admission = require('../models/Admission');
const AdmissionSagaAttempt = require('../models/AdmissionSagaAttempt');
const User = require('../models/User');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const StudentFee = require('../models/StudentFee');
const FeeStructure = require('../models/FeeStructure');
const AcademicYear = require('../models/AcademicYear');
const Counter = require('../models/Counter');
const EmailDelivery = require('../models/EmailDelivery');
const admissionService = require('../services/admission.service');
const {
  processDelivery,
  releaseStagedDeliveries,
  setEmailSenderForTests,
} = require('../services/email-delivery.service');

const runId = process.env.E1R3_TEST_RUN_ID || crypto.randomBytes(8).toString('hex');
assert(/^[A-Za-z0-9_-]{4,40}$/.test(runId), 'E1R3_TEST_RUN_ID must be 4-40 safe characters');
const admissionIds = [];
const fixtureUserIds = [];
const fixtureParentIds = [];
let feeStructureId;
let academicYearRecord;

async function createAdmission(label, overrides = {}) {
  const admission = await Admission.create({
    applicationNumber: `E1R3-${runId}-${label}`,
    studentName: `Synthetic E1R3 ${runId} ${label}`,
    dateOfBirth: new Date('2014-01-01'),
    classApplyingFor: '5',
    fatherName: 'Synthetic E1R3 Parent',
    fatherEmail: `e1r3-parent-${runId}-${label}@example.com`,
    fatherPhone: '+91 9876543210',
    status: 'Approved',
    enrollmentEffectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    enrollmentAcademicYear: '2026-2027',
    ...overrides,
  });
  admissionIds.push(admission._id);
  return admission;
}

async function assertSagaInvariants(admissionId, sagaId, expectedState = 'rolled_back') {
  const [admission, attempt] = await Promise.all([
    Admission.findById(admissionId).lean(),
    AdmissionSagaAttempt.findOne({ sagaId }).lean(),
  ]);
  assert(attempt, 'durable saga attempt must remain as an orphan-cleanup tombstone');
  assert.notStrictEqual(attempt.state, 'committed');
  assert.strictEqual(attempt.state, expectedState);
  assert.notStrictEqual(admission.status, 'Admitted');
  assert.notStrictEqual(admission.admissionSaga.commitMarker, `${sagaId}:${attempt.ownerGeneration}`);
  assert.strictEqual(await User.exists({ admissionSagaId: sagaId }), null, 'tagged users must be cleaned');
  assert.strictEqual(await Student.exists({ admissionSagaId: sagaId }), null, 'tagged students must be cleaned');
  assert.strictEqual(await StudentFee.exists({ admissionSagaId: sagaId }), null, 'tagged fees must be cleaned');
  assert.strictEqual(await Parent.exists({ admissionSagaId: sagaId }), null, 'owned parent profiles must be cleaned');
  const deliveries = await EmailDelivery.find({ admissionSagaId: sagaId }).lean();
  assert(deliveries.every((delivery) => delivery.status === 'expired' && !delivery.encryptedToken),
    'uncommitted generation deliveries must be expired and erased');
  for (const token of attempt.activationTokens || []) {
    assert.strictEqual(await User.exists({ _id: token.userId, activationToken: token.tokenHash }), null,
      'a token journaled by the rolled-back saga must be invalidated');
  }
  if (attempt.resources.parentLink) {
    assert.strictEqual(await Parent.exists({
      _id: attempt.resources.parentLink.parentId,
      children: attempt.resources.parentLink.studentId,
    }), null, 'the exact saga-owned parent-child link must be removed');
  }
}

async function assertCommittedSagaInvariants(admissionId, sagaId) {
  const [admission, attempt] = await Promise.all([
    Admission.findById(admissionId).lean(),
    AdmissionSagaAttempt.findOne({ sagaId }).lean(),
  ]);
  assert.strictEqual(attempt.state, 'committed');
  assert.strictEqual(attempt.commitMarker, `${sagaId}:${attempt.ownerGeneration}`);
  assert.strictEqual(admission.status, 'Admitted');
  assert.strictEqual(admission.admissionSaga.commitMarker, attempt.commitMarker);
  assert.strictEqual(String(admission.createdStudent), String(attempt.resources.studentId));
  assert(await Student.exists({ _id: attempt.resources.studentId, admissionSagaId: sagaId,
    admissionSagaGeneration: attempt.ownerGeneration }));
  assert(await User.exists({ _id: attempt.resources.studentUserId, admissionSagaId: sagaId,
    admissionSagaGeneration: attempt.ownerGeneration }));
}

async function runPausedOwnerRace(label, pausePoint, verifyPreserved, admissionOverrides = {}) {
  const admission = await createAdmission(label, admissionOverrides);
  const counterId = `rollNumber_2026-2027_${admission.classApplyingFor}`;
  const counterBefore = pausePoint.endsWith(':counter')
    ? await Counter.findById(counterId).lean()
    : null;
  let reached;
  let resume;
  const paused = new Promise((resolve) => { reached = resolve; });
  const gate = new Promise((resolve) => { resume = resolve; });
  admissionService.setSagaTestHook(async (point, context) => {
    if (point !== pausePoint) return;
    reached(context);
    await gate;
  });
  const ownerA = admissionService.admitStudent(admission._id).then(
    (student) => ({ student }),
    (error) => ({ error })
  );
  let context;
  try {
    context = await Promise.race([
      paused,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${pausePoint}`)), 20000)),
    ]);
    const attempt = await AdmissionSagaAttempt.findOne({ sagaId: context.sagaId });
    assert(attempt);
    const stagedBeforeRecovery = pausePoint.endsWith(':commit')
      ? await EmailDelivery.find({ admissionSagaId: context.sagaId, status: 'staged' }).distinct('_id')
      : [];
    await AdmissionSagaAttempt.updateOne({ sagaId: context.sagaId }, {
      $set: { leaseUntil: new Date(0), nextCleanupAt: new Date(0) },
    });
    await Admission.updateOne({ _id: admission._id }, { $set: { 'admissionSaga.leaseUntil': new Date(0) } });
    await admissionService.recoverStaleAdmissionSagas();
    const recovered = await AdmissionSagaAttempt.findOne({ sagaId: context.sagaId }).lean();
    assert.strictEqual(recovered.state, 'rolled_back', `${pausePoint}: owner B must recover the expired generation`);
    assert(recovered.ownerGeneration > context.generation, `${pausePoint}: recovery must fence the old generation`);
    if (stagedBeforeRecovery.length) {
      await releaseStagedDeliveries(stagedBeforeRecovery);
    }
  } finally {
    resume();
    admissionService.setSagaTestHook(null);
  }

  const result = await ownerA;
  assert(result.error, `${pausePoint}: stale owner A must not return a committed student`);
  if (pausePoint.endsWith(':counter')) {
    const counterAfter = await Counter.findById(counterId).lean();
    assert.strictEqual(counterAfter.seq, (counterBefore ? counterBefore.seq : 0) + 1,
      'a late roll-number reservation may leave one monotonic counter gap');
    assert.strictEqual(await Student.exists({ admissionSagaId: context.sagaId }), null,
      'the late counter increment must not create a student record');
  }
  const attempt = await AdmissionSagaAttempt.findOne({ sagaId: context.sagaId });
  await AdmissionSagaAttempt.updateOne({ sagaId: context.sagaId }, { $set: { nextCleanupAt: new Date(0) } });
  await admissionService.recoverStaleAdmissionSagas();
  await admissionService.recoverStaleAdmissionSagas();
  await assertSagaInvariants(admission._id, context.sagaId);
  if (verifyPreserved) await verifyPreserved(attempt);
  return { admissionId: admission._id, sagaId: context.sagaId };
}

async function waitForChildPause(child, expectedPoint) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for child pause at ${expectedPoint}`)), 20000);
    child.on('message', (message) => {
      if (message && message.type === 'paused' && message.point === expectedPoint) {
        clearTimeout(timeout);
        resolve(message);
      } else if (message && message.type === 'child-error') {
        clearTimeout(timeout);
        reject(new Error(`Saga child failed with ${message.code || 'CHILD_ERROR'}`));
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function testActualChildTermination(label, pausePoint) {
  const admission = await createAdmission(label);
  const child = fork(path.join(__dirname, 'test-admission-saga-e1r3-child.js'), [], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      E1R3_CHILD_ADMISSION_ID: String(admission._id),
      E1R3_CHILD_PAUSE_POINT: pausePoint,
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const pause = await waitForChildPause(child, pausePoint);
  const childExit = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  await childExit;
  const attempt = await AdmissionSagaAttempt.findOne({ sagaId: pause.sagaId });
  assert(attempt, 'child process must have durably recorded its saga before termination');
  if (pausePoint === 'after:commit_boundary') {
    await admissionService.recoverStaleAdmissionSagas();
    const staged = await EmailDelivery.find({ admissionSagaId: pause.sagaId, status: 'staged' }).distinct('_id');
    assert(staged.length > 0, 'the committed child must have staged activation deliveries before termination');
    await releaseStagedDeliveries(staged);
    await assertCommittedSagaInvariants(admission._id, pause.sagaId);
    assert.strictEqual(await EmailDelivery.countDocuments({ admissionSagaId: pause.sagaId, status: 'pending' }),
      staged.length, 'commit recovery must make only committed saga mail releasable');
    return;
  }
  await AdmissionSagaAttempt.updateOne({ sagaId: pause.sagaId }, {
    $set: { leaseUntil: new Date(0), nextCleanupAt: new Date(0) },
  });
  await Admission.updateOne({ _id: admission._id }, { $set: { 'admissionSaga.leaseUntil': new Date(0) } });
  await admissionService.recoverStaleAdmissionSagas();
  await AdmissionSagaAttempt.updateOne({ sagaId: pause.sagaId }, { $set: { nextCleanupAt: new Date(0) } });
  await admissionService.recoverStaleAdmissionSagas();
  await assertSagaInvariants(admission._id, pause.sagaId);
}

async function testCrashBeforeAttemptJournal() {
  const admission = await createAdmission('crash-before-attempt-journal');
  const child = fork(path.join(__dirname, 'test-admission-saga-e1r3-child.js'), [], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      E1R3_CHILD_ADMISSION_ID: String(admission._id),
      E1R3_CHILD_PAUSE_POINT: 'after:admission_claim',
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  await waitForChildPause(child, 'after:admission_claim');
  const childExit = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  await childExit;
  await Admission.updateOne({ _id: admission._id }, {
    $set: { 'admissionSaga.leaseUntil': new Date(0) },
  });
  await admissionService.recoverStaleAdmissionSagas();
  const recovered = await Admission.findById(admission._id).lean();
  assert.strictEqual(recovered.status, 'Admitting');
  assert.strictEqual(recovered.admissionSaga.state, 'manual_review');
  assert.strictEqual(await AdmissionSagaAttempt.exists({ admission: admission._id }), null);
  assert.strictEqual(await User.exists({ admissionSagaId: recovered.admissionSaga.id }), null);
  assert.strictEqual(await Student.exists({ admissionSagaId: recovered.admissionSaga.id }), null);
  assert.strictEqual(await StudentFee.exists({ admissionSagaId: recovered.admissionSaga.id }), null);
  assert.strictEqual(await EmailDelivery.exists({ admissionSagaId: recovered.admissionSaga.id }), null);
}

async function cleanupFixtures() {
  if (mongoose.connection.readyState !== 1) return;
  const attempts = await AdmissionSagaAttempt.find({ admission: { $in: admissionIds } }).lean();
  const sagaIds = attempts.map((attempt) => attempt.sagaId);
  const studentIds = attempts.map((attempt) => attempt.resources.studentId).filter(Boolean);
  const userIds = attempts.flatMap((attempt) => [
    attempt.resources.studentUserId,
    ...(attempt.resources.parentUserCreated ? [attempt.resources.parentUserId] : []),
  ]).filter(Boolean);
  const parentIds = attempts
    .filter((attempt) => attempt.resources.parentProfileCreated)
    .map((attempt) => attempt.resources.parentProfileId).filter(Boolean);
  if (studentIds.length) {
    await Parent.updateMany({ children: { $in: studentIds } }, { $pull: { children: { $in: studentIds } } }).catch(() => {});
    await StudentFee.deleteMany({ _id: { $in: attempts.map((attempt) => attempt.resources.studentFeeId).filter(Boolean) } }).catch(() => {});
    await Student.deleteMany({ _id: { $in: studentIds } }).catch(() => {});
  }
  if (sagaIds.length) await EmailDelivery.deleteMany({ admissionSagaId: { $in: sagaIds } }).catch(() => {});
  if (parentIds.length || fixtureParentIds.length) {
    await Parent.deleteMany({ _id: { $in: [...parentIds, ...fixtureParentIds] } }).catch(() => {});
  }
  await User.deleteMany({ _id: { $in: [...userIds, ...fixtureUserIds] } }).catch(() => {});
  if (sagaIds.length) await AdmissionSagaAttempt.deleteMany({ sagaId: { $in: sagaIds } }).catch(() => {});
  await Admission.deleteMany({ _id: { $in: admissionIds } }).catch(() => {});
  if (feeStructureId) await FeeStructure.deleteOne({ _id: feeStructureId }).catch(() => {});
  if (academicYearRecord) await AcademicYear.deleteOne({ _id: academicYearRecord._id }).catch(() => {});
}

async function main() {
  await mongoose.connect(mongoUri);
  let smtpCalls = 0;
  setEmailSenderForTests(async () => { smtpCalls += 1; return { messageId: 'synthetic-e1r3' }; });
  feeStructureId = (await FeeStructure.create({
    name: `Synthetic E1R3 ${runId} fee`,
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

  const writePoints = [
    'after:ownership-validated:counter',
    'after:ownership-validated:student_user',
    'after:ownership-validated:parent_user',
    'after:ownership-validated:parent_profile',
    'after:ownership-validated:student',
    'after:ownership-validated:parent_link',
    'after:ownership-validated:student_fee',
    'after:ownership-validated:student_activation_token',
    'after:ownership-validated:email_delivery',
    'after:ownership-validated:commit',
  ];
  for (let index = 0; index < writePoints.length; index += 1) {
    await runPausedOwnerRace(`pause-${index}`, writePoints[index]);
  }

  const sharedParentUser = await User.create({
    name: 'Synthetic E1R3 Shared Parent',
    email: `e1r3-shared-${runId}@example.com`,
    password: 'Synthetic-E1R3-Password-2026!',
    role: 'parent',
    isActive: true,
    isEmailVerified: true,
  });
  fixtureUserIds.push(sharedParentUser._id);
  const unrelatedChildId = new mongoose.Types.ObjectId();
  const sharedParent = await Parent.create({
    user: sharedParentUser._id,
    children: [unrelatedChildId],
    relationship: 'Father',
  });
  fixtureParentIds.push(sharedParent._id);
  await runPausedOwnerRace('shared-parent', 'after:ownership-validated:parent_link', async (attempt) => {
    assert.strictEqual(String(attempt.resources.parentUserId), String(sharedParentUser._id),
      'the saga must reuse the fixture parent account');
    assert.strictEqual(String(attempt.resources.parentProfileId), String(sharedParent._id),
      'the saga must reuse the fixture parent profile');
    const reloaded = await Parent.findById(sharedParent._id).select('+admissionSagaLinks').lean();
    assert(reloaded, 'pre-existing parent profile must be preserved');
    assert.deepStrictEqual(reloaded.children.map(String), [String(unrelatedChildId)],
      'compensation must retain unrelated child links');
    assert(!(reloaded.admissionSagaLinks || []).some((link) => link.sagaId === attempt.sagaId),
      'the exact saga-owned link marker must be removed');
    assert(await User.exists({ _id: sharedParentUser._id }), 'pre-existing parent account must be preserved');
  }, { fatherEmail: sharedParentUser.email });

  await testActualChildTermination('actual-child-after-user-write', 'after:student_user_write');
  await testActualChildTermination('actual-child-after-parent-link', 'after:parent_link_write');
  await testActualChildTermination('actual-child-after-commit', 'after:commit_boundary');
  await testCrashBeforeAttemptJournal();
  assert.strictEqual(smtpCalls, 0, 'no test path may contact SMTP');
  console.log('PASS E1-R3 deterministic stale-owner races, repeat cleanup, shared-parent safety, and child termination');
}

main().catch((error) => {
  const detail = error && error.code ? ` [${error.code}]` : '';
  console.error(`E1-R3 guarded integration failed${detail}`);
  process.exitCode = 1;
}).finally(async () => {
  admissionService.setSagaTestHook(null);
  setEmailSenderForTests(null);
  try { await cleanupFixtures(); } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
  }
});
