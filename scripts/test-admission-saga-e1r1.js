'use strict';

const assert = require('assert');
const crypto = require('crypto');

if (process.env.NODE_ENV && process.env.NODE_ENV !== 'test') {
  throw new Error('Refusing admission saga tests unless NODE_ENV is test.');
}
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = '';
process.env.CORS_ORIGIN = 'http://127.0.0.1';
process.env.TRUST_PROXY_HOPS = '0';
process.env.EMAIL_TRANSPORT = 'json';
process.env.FRONTEND_URL = 'http://127.0.0.1';
process.env.EMAIL_ENCRYPTION_KEY_VERSION = 'e1r1-saga-test';
process.env.EMAIL_ENCRYPTION_KEY = crypto.createHash('sha256').update('synthetic-e1r1-saga-only-key').digest('base64');

const mongoUri = process.env.MONGO_TEST_URI;
assert(mongoUri, 'MONGO_TEST_URI is required; refusing implicit MongoDB selection');
assert.strictEqual(process.env.ALLOW_E1R1_TEST_WRITES, '1', 'Set ALLOW_E1R1_TEST_WRITES=1 to authorize isolated test writes');
const parsed = new URL(mongoUri);
const databaseName = parsed.pathname.replace(/^\/+/, '');
assert(['localhost', '127.0.0.1', '::1'].includes(parsed.hostname), 'MongoDB tests only permit localhost');
assert(/^erp_security_e1r1_[A-Za-z0-9_-]+$/.test(databaseName), 'Mongo database must be named erp_security_e1r1_*');

const mongoose = require('mongoose');
const AcademicYear = require('../models/AcademicYear');
const Admission = require('../models/Admission');
const AdmissionSagaAttempt = require('../models/AdmissionSagaAttempt');
const EmailDelivery = require('../models/EmailDelivery');
const FeeStructure = require('../models/FeeStructure');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const StudentFee = require('../models/StudentFee');
const User = require('../models/User');
const authService = require('../services/auth.service');
const admissionService = require('../services/admission.service');

const runId = process.env.E1R1_TEST_RUN_ID || crypto.randomBytes(8).toString('hex');
assert(/^[A-Za-z0-9_-]{4,40}$/.test(runId), 'E1R1_TEST_RUN_ID must be 4-40 safe characters');
const admissionIds = [];
let feeStructure;
let academicYearRecord;

async function createAdmission(label, fatherEmail) {
  const admission = await Admission.create({
    studentName: `Synthetic E1R1 ${runId} ${label}`,
    dateOfBirth: new Date('2014-01-01'),
    classApplyingFor: '5',
    fatherName: 'Synthetic Parent',
    fatherEmail,
    fatherPhone: '+91 9876543210',
    status: 'Approved',
    enrollmentEffectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    enrollmentAcademicYear: '2026-2027',
  });
  admissionIds.push(admission._id);
  return admission;
}

async function expectCompensated(admission, label) {
  const current = await Admission.findById(admission._id).lean();
  assert.strictEqual(current.status, 'Approved', `${label}: admission must return to Approved`);
  assert.strictEqual(current.createdStudent, undefined, `${label}: must clear createdStudent`);
  const users = await User.find({ name: `Synthetic E1R1 ${runId} ${label}` }).select('_id');
  assert.strictEqual(users.length, 0, `${label}: newly created student account must be removed`);
  const staged = await EmailDelivery.find({ relatedAdmission: admission._id }).lean();
  assert(staged.every((row) => row.status === 'expired' && !row.encryptedToken),
    `${label}: staged outbox tokens must be invalidated and erased`);
}

async function failOnce(target, property, predicate, error) {
  const original = target[property];
  let fired = false;
  target[property] = async function (...args) {
    if (!fired && predicate(...args)) {
      fired = true;
      throw error;
    }
    return original.apply(this, args);
  };
  return async () => {
    target[property] = original;
    assert(fired, `Failure injection for ${property} did not run`);
  };
}

async function injectFailure(label, patch, reusedParent = false) {
  const fatherEmail = reusedParent
    ? `e1r1-parent-${runId}@example.com`
    : `e1r1-parent-${runId}-${label}@example.com`;
  const admission = await createAdmission(label, fatherEmail);
  const restore = await patch();
  try {
    await assert.rejects(admissionService.admitStudent(admission._id));
  } finally {
    await restore();
  }
  await expectCompensated(admission, label);

  if (reusedParent) {
    const reused = await User.findOne({ email: fatherEmail });
    assert(reused, 'A reused parent account must remain after student saga compensation');
    const parent = await Parent.findOne({ user: reused._id });
    assert(parent, 'A reused parent profile must remain after student saga compensation');
    assert.strictEqual(parent.children.length, 0, 'Compensation must remove only the child link added by this saga');
  }
}

async function main() {
  await mongoose.connect(mongoUri);
  academicYearRecord = await AcademicYear.create({
    name: '2026-2027',
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2027-03-31T23:59:59.999Z'),
    isCurrent: true,
    isActive: true,
  });
  feeStructure = await FeeStructure.create({
    name: `Synthetic E1R1 ${runId} fee`,
    class: '5',
    academicYear: '2026-2027',
    components: [{ name: 'Synthetic tuition', amount: 100, type: 'Tuition' }],
    isActive: true,
  });

  await injectFailure('user-create', () => failOnce(
    User, 'create', (data) => data && data.role === 'student', new Error('synthetic user-create failure')
  ));
  await injectFailure('parent-profile', () => failOnce(
    Parent, 'create', () => true, new Error('synthetic parent-profile failure')
  ));
  await injectFailure('student-create', () => failOnce(
    Student, 'create', () => true, new Error('synthetic student-create failure')
  ));
  await injectFailure('activation-stage', async () => {
    const original = authService.sendActivationEmail;
    let fired = false;
    authService.sendActivationEmail = async (...args) => {
      if (!fired) { fired = true; throw new Error('synthetic activation-stage failure'); }
      return original.apply(authService, args);
    };
    return async () => {
      authService.sendActivationEmail = original;
      assert(fired, 'Activation failure injection did not run');
    };
  });

  const parentEmail = `e1r1-parent-${runId}@example.com`;
  const reusedParentUser = await User.create({
    name: `Synthetic E1R1 ${runId} reused-parent`,
    email: parentEmail,
    password: 'Synthetic-E1R1-Password-2026!',
    role: 'parent',
    isActive: true,
    isEmailVerified: true,
  });
  await Parent.create({ user: reusedParentUser._id, children: [], relationship: 'Father' });

  await injectFailure('fee-create', () => failOnce(
    StudentFee, 'create', () => true, new Error('synthetic StudentFee.create failure')
  ), true);
  await injectFailure('admission-commit', () => failOnce(
    AdmissionSagaAttempt, 'updateOne', (filter, update) => update && update.$set && update.$set.state === 'committed',
    new Error('synthetic admission commit failure')
  ));

  console.log('PASS admission saga compensations for account, parent, student, activation, fee, and admission-commit failures');
}

main().catch((error) => {
  const message = String(error.message || 'Admission saga test failed')
    .replace(/(?:mongodb(?:\+srv)?|rediss?):\/\/\S+/gi, '[connection URI]');
  console.error(message);
  process.exitCode = 1;
}).finally(async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      const names = new RegExp(`^Synthetic E1R1 ${runId}`);
      const users = await User.find({ name: names }).select('_id');
      const userIds = users.map(({ _id }) => _id);
      const students = await Student.find({ user: { $in: userIds } }).select('_id');
      const studentIds = students.map(({ _id }) => _id);
      await StudentFee.deleteMany({ student: { $in: studentIds } }).catch(() => {});
      await Student.deleteMany({ _id: { $in: studentIds } }).catch(() => {});
      await Parent.deleteMany({ user: { $in: userIds } }).catch(() => {});
      await EmailDelivery.deleteMany({ $or: [
        { user: { $in: userIds } },
        { relatedAdmission: { $in: admissionIds } },
      ] }).catch(() => {});
      await User.deleteMany({ _id: { $in: userIds } }).catch(() => {});
      await Admission.deleteMany({ _id: { $in: admissionIds } }).catch(() => {});
      if (feeStructure) await FeeStructure.deleteOne({ _id: feeStructure._id }).catch(() => {});
      if (academicYearRecord) await AcademicYear.deleteOne({ _id: academicYearRecord._id }).catch(() => {});
    }
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
  }
});
