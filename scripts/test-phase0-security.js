const assert = require('assert');
const { spawnSync } = require('child_process');
const mongoose = require('mongoose');

async function testCookieOnlyAuthentication() {
  const { sendTokenResponse } = require('../utils/generateToken');
  let responseBody;
  let cookie;
  const res = {
    status() { return this; },
    cookie(name, value, options) {
      cookie = { name, value, options };
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  sendTokenResponse({
    _id: new mongoose.Types.ObjectId(),
    name: 'Test User',
    email: 'test@example.com',
    role: 'student',
    profilePhoto: 'default-avatar.png',
  }, 200, res, 'Login successful');

  assert(cookie && cookie.name === 'token', 'Login must set the auth cookie');
  assert(cookie.options.httpOnly === true, 'Auth cookie must be HTTP-only');
  assert(cookie.options.sameSite === 'strict', 'Auth cookie must remain SameSite strict');
  assert(!Object.prototype.hasOwnProperty.call(responseBody.data, 'token'), 'Login JSON must not contain a JWT');
}

async function testAdmissionAccountsArePending() {
  const Admission = require('../models/Admission');
  const User = require('../models/User');
  const Student = require('../models/Student');
  const Parent = require('../models/Parent');
  const Counter = require('../models/Counter');
  const original = {
    admissionFindById: Admission.findById,
    userCreate: User.create,
    userFindOne: User.findOne,
    studentCreate: Student.create,
    parentFindOne: Parent.findOne,
    parentCreate: Parent.create,
    studentFindByIdAndDelete: Student.findByIdAndDelete,
    userFindByIdAndDelete: User.findByIdAndDelete,
    counterFindByIdAndUpdate: Counter.findByIdAndUpdate,
  };
  const authService = require('../services/auth.service');
  const originalSendActivationEmail = authService.sendActivationEmail;
  const createdUsers = [];
  const admission = {
    status: 'Approved',
    studentName: 'Pending Student',
    classApplyingFor: '5',
    fatherName: 'Parent',
    fatherEmail: 'parent@example.com',
    save: async function () {},
  };

  Admission.findById = async () => admission;
  Counter.findByIdAndUpdate = async () => ({ seq: 1 });
  User.findOne = async () => null;
  User.create = async (data) => {
    const user = { _id: new mongoose.Types.ObjectId(), ...data };
    createdUsers.push(user);
    return user;
  };
  Parent.findOne = async () => null;
  Parent.create = async (data) => ({
    _id: new mongoose.Types.ObjectId(),
    ...data,
    save: async function () {},
  });
  Student.create = async (data) => ({ _id: new mongoose.Types.ObjectId(), ...data });
  Student.findByIdAndDelete = async () => null;
  User.findByIdAndDelete = async () => null;
  const FeeStructure = require('../models/FeeStructure');
  const StudentFee = require('../models/StudentFee');
  const originalFeeFindOne = FeeStructure.findOne;
  const originalFeeCreate = StudentFee.create;
  FeeStructure.findOne = async () => null;
  StudentFee.create = async () => null;

  try {
    authService.sendActivationEmail = async (user) => {
      user.activationToken = 'synthetic-hash';
      user.activationTokenExpire = Date.now() + 86400000;
    };
    delete require.cache[require.resolve('../services/admission.service')];
    const admissionService = require('../services/admission.service');
    await admissionService.admitStudent(new mongoose.Types.ObjectId());
    assert.strictEqual(createdUsers.length, 2, 'Admission should create pending student and parent users');
    for (const user of createdUsers) {
      assert.notStrictEqual(user.password, 'Password@123', 'Shared admission password must not be used');
      assert(user.password.length >= 32, 'Pending account password must be unpredictable');
      assert.strictEqual(user.isActive, false, 'Admission-created accounts must be non-login-enabled');
      assert.strictEqual(user.isEmailVerified, false, 'Pending accounts must not be verified');
    }
  } finally {
    Admission.findById = original.admissionFindById;
    User.create = original.userCreate;
    User.findOne = original.userFindOne;
    Student.create = original.studentCreate;
    Parent.findOne = original.parentFindOne;
    Parent.create = original.parentCreate;
    Student.findByIdAndDelete = original.studentFindByIdAndDelete;
    User.findByIdAndDelete = original.userFindByIdAndDelete;
    Counter.findByIdAndUpdate = original.counterFindByIdAndUpdate;
    FeeStructure.findOne = originalFeeFindOne;
    StudentFee.create = originalFeeCreate;
    authService.sendActivationEmail = originalSendActivationEmail;
  }
}

async function testAttendanceAccess() {
  const Student = require('../models/Student');
  const Faculty = require('../models/Faculty');
  const Parent = require('../models/Parent');
  const SubjectAllocation = require('../models/SubjectAllocation');
  const Attendance = require('../models/Attendance');
  const original = {
    studentFindById: Student.findById,
    facultyFindOne: Faculty.findOne,
    parentFindOne: Parent.findOne,
    allocationExists: SubjectAllocation.exists,
    summary: Attendance.getStudentSummary,
  };
  const ids = {
    ownUser: new mongoose.Types.ObjectId(),
    otherUser: new mongoose.Types.ObjectId(),
    child: new mongoose.Types.ObjectId(),
    unrelated: new mongoose.Types.ObjectId(),
    teacher: new mongoose.Types.ObjectId(),
  };
  const students = {
    own: { _id: ids.child, user: ids.ownUser, class: '5' },
    other: { _id: ids.unrelated, user: ids.otherUser, class: '6' },
  };
  Student.findById = (id) => ({
    select: async () => id.toString() === ids.child.toString() ? students.own : students.other,
  });
  Faculty.findOne = () => ({ select: async () => ({ _id: new mongoose.Types.ObjectId(), classTeacherOf: { class: '5' } }) });
  Parent.findOne = () => ({ select: async () => ({ children: [ids.child] }) });
  SubjectAllocation.exists = async () => false;
  Attendance.getStudentSummary = async (...args) => args;
  const service = require('../services/attendance.service');

  try {
    await service.getStudentAttendanceSummary(ids.child, '2026-2027', { _id: ids.ownUser, role: 'student' });
    await service.getStudentAttendanceSummary(ids.child, '2026-2027', { _id: ids.teacher, role: 'teacher' });
    await service.getStudentAttendanceSummary(ids.child, '2026-2027', { _id: new mongoose.Types.ObjectId(), role: 'parent' });
    await service.getStudentAttendanceSummary(ids.child, '2026-2027', { _id: new mongoose.Types.ObjectId(), role: 'school_admin' });
    await assert.rejects(
      service.getStudentAttendanceSummary(ids.unrelated, '2026-2027', { _id: ids.ownUser, role: 'student' }),
      (error) => error.statusCode === 403
    );
    await assert.rejects(
      service.getStudentAttendanceSummary(ids.unrelated, '2026-2027', { _id: ids.teacher, role: 'teacher' }),
      (error) => error.statusCode === 403
    );
    await assert.rejects(
      service.getStudentAttendanceSummary(ids.unrelated, '2026-2027', { _id: new mongoose.Types.ObjectId(), role: 'parent' }),
      (error) => error.statusCode === 403
    );
  } finally {
    Student.findById = original.studentFindById;
    Faculty.findOne = original.facultyFindOne;
    Parent.findOne = original.parentFindOne;
    SubjectAllocation.exists = original.allocationExists;
    Attendance.getStudentSummary = original.summary;
  }
}

async function testAttendanceWrites() {
  const Student = require('../models/Student');
  const Faculty = require('../models/Faculty');
  const SubjectAllocation = require('../models/SubjectAllocation');
  const Subject = require('../models/Subject');
  const Attendance = require('../models/Attendance');
  const original = {
    studentFind: Student.find,
    facultyFindOne: Faculty.findOne,
    allocationFindOne: SubjectAllocation.findOne,
    subjectFindOne: Subject.findOne,
    bulkWrite: Attendance.bulkWrite,
    attendanceFindById: Attendance.findById,
    attendanceFindByIdAndUpdate: Attendance.findByIdAndUpdate,
  };
  const teacherId = new mongoose.Types.ObjectId();
  const facultyId = new mongoose.Types.ObjectId();
  const subjectId = new mongoose.Types.ObjectId();
  const assignedStudent = new mongoose.Types.ObjectId();
  const otherClassStudent = new mongoose.Types.ObjectId();
  const assignedUser = { _id: teacherId, role: 'teacher' };
  const subject = { _id: subjectId };
  const faculty = { _id: facultyId, classTeacherOf: { class: '5', academicYear: '2026-2027' } };
  const writes = [];
  let updatePayload;

  Student.find = () => ({
    select: async () => [{ _id: assignedStudent }],
  });
  Faculty.findOne = (query) => ({
    select: async () => query.user.toString() === teacherId.toString() ? faculty : null,
  });
  Subject.findOne = () => ({ select: async () => subject });
  SubjectAllocation.findOne = async (query) => (
    query.class === '5' && query.subject.toString() === subjectId.toString()
      ? { _id: new mongoose.Types.ObjectId() }
      : null
  );
  Attendance.bulkWrite = async (operations) => {
    writes.push(operations);
    return { modifiedCount: 1, upsertedCount: 0 };
  };
  Attendance.findById = () => ({
    select: async () => ({
      _id: new mongoose.Types.ObjectId(),
      student: assignedStudent,
      class: '5',
      subject: subjectId.toString(),
      academicYear: '2026-2027',
    }),
  });
  Attendance.findByIdAndUpdate = async (id, update) => {
    updatePayload = update;
    return { _id: id, ...update.$set };
  };

  const service = require('../services/attendance.service');
  try {
    await service.markBulkAttendance({
      class: '5',
      date: '2026-11-02',
      academicYear: '2026-2027',
      subject: subjectId.toString(),
      attendanceData: [{ student: assignedStudent.toString(), status: 'Present' }],
    }, assignedUser);
    assert.strictEqual(writes.length, 1, 'Assigned teacher should mark attendance');
    assert.deepStrictEqual(
      Object.keys(writes[0][0].updateOne.filter).sort(),
      ['academicYear', 'class', 'date', 'student', 'subject'].sort(),
      'Attendance upsert must be scoped by class and academic year'
    );

    await assert.rejects(
      service.markBulkAttendance({
        class: '6',
        date: '2026-11-02',
        academicYear: '2026-2027',
        subject: subjectId.toString(),
        attendanceData: [{ student: assignedStudent.toString(), status: 'Present' }],
      }, assignedUser),
      (error) => error.statusCode === 403
    );
    await assert.rejects(
      service.markBulkAttendance({
        class: '5',
        date: '2026-11-02',
        academicYear: '2026-2027',
        subject: subjectId.toString(),
        attendanceData: [{ student: otherClassStudent.toString(), status: 'Present' }],
      }, assignedUser),
      (error) => error.statusCode === 403
    );

    await assert.rejects(
      service.updateAttendance(new mongoose.Types.ObjectId(), { status: 'Absent' }, {
        _id: new mongoose.Types.ObjectId(),
        role: 'teacher',
      }),
      (error) => error.statusCode === 403
    );
    const updated = await service.updateAttendance(
      new mongoose.Types.ObjectId(),
      { status: 'Late', class: '99', student: otherClassStudent.toString() },
      assignedUser
    );
    assert.strictEqual(updated.status, 'Late', 'Assigned teacher should update attendance');
    assert.strictEqual(updatePayload.$set.class, undefined, 'Attendance class must not be changed by request body');
    assert.strictEqual(updatePayload.$set.student, undefined, 'Attendance student must not be changed by request body');
  } finally {
    Student.find = original.studentFind;
    Faculty.findOne = original.facultyFindOne;
    SubjectAllocation.findOne = original.allocationFindOne;
    Subject.findOne = original.subjectFindOne;
    Attendance.bulkWrite = original.bulkWrite;
    Attendance.findById = original.attendanceFindById;
    Attendance.findByIdAndUpdate = original.attendanceFindByIdAndUpdate;
  }
}

async function testCookieOnlyMiddleware() {
  const jwt = require('jsonwebtoken');
  const User = require('../models/User');
  const { protect } = require('../middleware/auth.middleware');
  const originalVerify = jwt.verify;
  const originalFindById = User.findById;
  jwt.verify = () => ({ id: new mongoose.Types.ObjectId() });
  User.findById = () => ({ select: async () => ({ _id: new mongoose.Types.ObjectId(), isActive: true }) });
  try {
    let error;
    await new Promise((resolve) => protect({ headers: { authorization: 'Bearer fake' }, cookies: {} }, {}, (err) => {
      error = err;
      resolve();
    }));
    assert.strictEqual(error.statusCode, 401, 'Bearer authentication must be rejected');

    let authenticated = false;
    await new Promise((resolve) => protect({ headers: {}, cookies: { token: 'cookie-token' } }, {}, (err) => {
      authenticated = !err;
      resolve();
    }));
    assert(authenticated, 'Cookie authentication must remain supported');
  } finally {
    jwt.verify = originalVerify;
    User.findById = originalFindById;
  }
}

async function testDatabaseLogging() {
  const db = require('../config/db');
  const originalConnect = mongoose.connect;
  const originalExit = process.exit;
  const originalError = console.error;
  const messages = [];
  const sensitiveUri = 'mongodb://user:password@example.invalid/production';
  mongoose.connect = async () => {
    const error = new Error(`connection failed for ${sensitiveUri}`);
    error.name = 'MongoNetworkError';
    throw error;
  };
  process.exit = () => {};
  console.error = (...args) => messages.push(args.join(' '));
  process.env.MONGO_URI = sensitiveUri;

  try {
    await db();
    assert(!messages.some((message) => message.includes(sensitiveUri) || message.includes('password')),
      'Database connection logging must not expose the connection string');
  } finally {
    mongoose.connect = originalConnect;
    process.exit = originalExit;
    console.error = originalError;
  }
}

function testServerDatabaseLogging() {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: require('path').resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://127.0.0.1:1/phase0',
      PORT: '0',
    },
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert(!output.includes('mongodb://'), 'Server database errors must not expose the MongoDB URI');
  assert(!output.toLowerCase().includes('password'), 'Server database errors must not expose credentials');
}

(async () => {
  await testCookieOnlyAuthentication();
  await testAdmissionAccountsArePending();
  await testAttendanceAccess();
  await testAttendanceWrites();
  await testCookieOnlyMiddleware();
  await testDatabaseLogging();
  testServerDatabaseLogging();
  console.log('All Phase 0 security regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
