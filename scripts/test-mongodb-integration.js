const assert = require('assert');
const crypto = require('crypto');
const mongoose = require('mongoose');

const TEST_URI = process.env.MONGO_TEST_URI;
const TEST_DATABASE_PREFIX = 'erp_security_it_';

function assertSafeTestUri(uri) {
  assert(uri, 'MONGO_TEST_URI is required; refusing to fall back to another database');
  const parsed = new URL(uri);
  assert(['localhost', '127.0.0.1', '::1'].includes(parsed.hostname),
    'Integration tests only permit localhost MongoDB');
  const database = parsed.pathname.replace(/^\/+/, '');
  assert(database.startsWith(TEST_DATABASE_PREFIX),
    `Database must start with ${TEST_DATABASE_PREFIX}`);
  assert.strictEqual(process.env.NODE_ENV, 'test',
    'NODE_ENV=test is required for destructive MongoDB integration tests');
  assert.strictEqual(process.env.ALLOW_MONGODB_IT_TEST_DB_DROP, '1',
    'Set ALLOW_MONGODB_IT_TEST_DB_DROP=1 to authorize integration test database cleanup');
  return parsed;
}

const parsedUri = assertSafeTestUri(TEST_URI);
process.env.NODE_ENV = 'test';

const User = require('../models/User');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const Faculty = require('../models/Faculty');
const Subject = require('../models/Subject');
const SubjectAllocation = require('../models/SubjectAllocation');
const Attendance = require('../models/Attendance');
const AcademicYear = require('../models/AcademicYear');
const authService = require('../services/auth.service');
const attendanceService = require('../services/attendance.service');
const { protect } = require('../middleware/auth.middleware');

const ids = {};
const syntheticPassword = 'Synthetic-Only-Password-2026!';
const academicYear = '2026-2027';

function expectStatus(error, statusCode) {
  return error && error.statusCode === statusCode;
}

async function createUser(data) {
  return User.create({
    name: data.name,
    email: data.email,
    password: data.password || syntheticPassword,
    role: data.role,
    permissions: data.permissions || [],
    isActive: data.isActive !== false,
  });
}

async function seedFixtures() {
  const subjectA = await Subject.create({
    name: 'Synthetic Mathematics',
    code: `SYN-${crypto.randomBytes(4).toString('hex')}`,
    type: 'Core',
    classLevels: ['5'],
    isActive: true,
  });
  const subjectB = await Subject.create({
    name: 'Synthetic Science',
    code: `SYN-${crypto.randomBytes(4).toString('hex')}`,
    type: 'Core',
    classLevels: ['6'],
    isActive: true,
  });

  const teacherUser = await createUser({
    name: 'Synthetic Assigned Teacher',
    email: `teacher-${crypto.randomBytes(4).toString('hex')}@example.com`,
    role: 'teacher',
  });
  const otherTeacherUser = await createUser({
    name: 'Synthetic Other Teacher',
    email: `other-teacher-${crypto.randomBytes(4).toString('hex')}@example.com`,
    role: 'teacher',
  });
  const classTeacherUser = await createUser({
    name: 'Synthetic Class Teacher',
    email: `class-teacher-${crypto.randomBytes(4).toString('hex')}@example.com`,
    role: 'class_teacher',
  });
  const adminUser = await createUser({
    name: 'Synthetic Admin',
    email: `admin-${crypto.randomBytes(4).toString('hex')}@example.com`,
    role: 'school_admin',
    permissions: ['attendance.mark', 'attendance.edit-authorized'],
  });
  const superAdminUser = await createUser({
    name: 'Synthetic Super Admin',
    email: `super-admin-${crypto.randomBytes(4).toString('hex')}@example.com`,
    role: 'super_admin',
  });
  const studentUser = await createUser({
    name: 'Synthetic Student A',
    email: `student-a-${crypto.randomBytes(4).toString('hex')}@example.com`,
    role: 'student',
  });
  const studentBUser = await createUser({
    name: 'Synthetic Student B',
    email: `student-b-${crypto.randomBytes(4).toString('hex')}@example.com`,
    role: 'student',
  });
  const parentUser = await createUser({
    name: 'Synthetic Parent A',
    email: `parent-a-${crypto.randomBytes(4).toString('hex')}@example.com`,
    role: 'parent',
  });
  const unrelatedParentUser = await createUser({
    name: 'Synthetic Unrelated Parent',
    email: `parent-b-${crypto.randomBytes(4).toString('hex')}@example.com`,
    role: 'parent',
  });
  const inactiveUser = await createUser({
    name: 'Synthetic Inactive Admission User',
    email: `inactive-${crypto.randomBytes(4).toString('hex')}@example.com`,
    role: 'student',
    isActive: false,
  });

  const faculty = await Faculty.create({
    user: teacherUser._id,
    department: 'Mathematics',
    designation: 'Teacher',
    joiningDate: new Date(),
  });
  const otherFaculty = await Faculty.create({
    user: otherTeacherUser._id,
    department: 'Science',
    designation: 'Teacher',
    joiningDate: new Date(),
  });
  const classFaculty = await Faculty.create({
    user: classTeacherUser._id,
    department: 'Mathematics',
    designation: 'Teacher',
    joiningDate: new Date(),
    classTeacherOf: { class: '5', academicYear },
  });

  const studentA = await Student.create({
    user: studentUser._id,
    rollNumber: 1,
    class: '5',
    academicYear,
    enrollmentEffectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    father: { name: 'Synthetic Father A' },
    mother: { name: 'Synthetic Mother A' },
  });
  const studentB = await Student.create({
    user: studentBUser._id,
    rollNumber: 2,
    class: '6',
    academicYear,
    father: { name: 'Synthetic Father B' },
    mother: { name: 'Synthetic Mother B' },
  });
  await Parent.create({
    user: parentUser._id,
    relationship: 'Father',
    children: [studentA._id],
  });
  await Parent.create({
    user: unrelatedParentUser._id,
    relationship: 'Father',
    children: [],
  });
  await SubjectAllocation.create({
    teacher: faculty._id,
    subject: subjectA._id,
    class: '5',
    academicYear,
  });
  await SubjectAllocation.create({
    teacher: otherFaculty._id,
    subject: subjectB._id,
    class: '6',
    academicYear,
  });

  Object.assign(ids, {
    subjectA: subjectA._id,
    subjectB: subjectB._id,
    teacherUser,
    otherTeacherUser,
    classTeacherUser,
    adminUser,
    superAdminUser,
    studentUser,
    studentBUser,
    parentUser,
    unrelatedParentUser,
    inactiveUser,
    faculty,
    classFaculty,
    studentA,
    studentB,
  });
}

async function testAttendanceAuthorization() {
  const assignedTeacher = { _id: ids.teacherUser._id, role: 'teacher' };
  const otherTeacher = { _id: ids.otherTeacherUser._id, role: 'teacher' };
  const classTeacher = { _id: ids.classTeacherUser._id, role: 'class_teacher' };
  const admin = { _id: ids.adminUser._id, role: 'school_admin', permissions: ['attendance.mark', 'attendance.edit-authorized'] };
  const superAdmin = { _id: ids.superAdminUser._id, role: 'super_admin' };
  const base = {
    date: '2026-11-02',
    academicYear,
    subject: ids.subjectA.toString(),
  };

  await attendanceService.markBulkAttendance({
    ...base,
    class: '5',
    attendanceData: [{ student: ids.studentA._id, status: 'Present', expectedRevision: null }],
  }, assignedTeacher);
  assert.strictEqual(await Attendance.countDocuments(), 1, 'Assigned teacher should create attendance');

  await assert.rejects(
    attendanceService.markBulkAttendance({
      ...base,
      class: '6',
      attendanceData: [{ student: ids.studentB._id, status: 'Present', expectedRevision: null }],
    }, assignedTeacher),
    (error) => expectStatus(error, 403)
  );
  await assert.rejects(
    attendanceService.markBulkAttendance({
      ...base,
      class: '5',
      subject: ids.subjectB.toString(),
      attendanceData: [{ student: ids.studentA._id, status: 'Present', expectedRevision: null }],
    }, assignedTeacher),
    (error) => expectStatus(error, 403)
  );
  await assert.rejects(
    attendanceService.markBulkAttendance({
      ...base,
      class: '5',
      attendanceData: [{ student: ids.studentB._id, status: 'Present', expectedRevision: null }],
    }, assignedTeacher),
    (error) => expectStatus(error, 403)
  );
  await assert.rejects(
    attendanceService.markBulkAttendance({
      ...base,
      class: '5',
      attendanceData: [
        { student: ids.studentA._id, status: 'Present', expectedRevision: null },
        { student: ids.studentA._id, status: 'Absent', expectedRevision: null },
      ],
    }, assignedTeacher),
    (error) => expectStatus(error, 400)
  );
  await assert.rejects(
    attendanceService.markBulkAttendance({
      ...base,
      class: '5',
      academicYear: '2027-2028',
      attendanceData: [{ student: ids.studentA._id, status: 'Present', expectedRevision: null }],
    }, assignedTeacher),
    (error) => expectStatus(error, 403)
  );
  await assert.rejects(
    attendanceService.markBulkAttendance({
      ...base,
      class: '5',
      attendanceData: [{ student: ids.studentA._id, status: 'Present', expectedRevision: null }],
    }, classTeacher),
    (error) => expectStatus(error, 403)
  );

  const attendanceAfterCreate = await Attendance.findOne({ student: ids.studentA._id }).lean();
  await attendanceService.markBulkAttendance({
    ...base,
    class: '5',
    attendanceData: [{ student: ids.studentA._id, status: 'Absent', expectedRevision: attendanceAfterCreate.revision }],
  }, admin);
  const attendanceAfterAdmin = await Attendance.findOne({ student: ids.studentA._id }).lean();
  await attendanceService.markBulkAttendance({
    ...base,
    class: '5',
    attendanceData: [{ student: ids.studentA._id, status: 'Late', expectedRevision: attendanceAfterAdmin.revision }],
  }, superAdmin);

  assert.strictEqual(await Attendance.countDocuments(), 1,
    'Unauthorized requests must not create additional records');
  console.log('PASS attendance authorization and no-partial-write checks');
}

async function testAttendanceUpdatesAndIndexes() {
  const attendance = await Attendance.findOne({ student: ids.studentA._id });
  assert(attendance, 'Fixture attendance must exist');

  await attendanceService.updateAttendance(attendance._id, {
    status: 'Late',
    class: '6',
    subject: ids.subjectB.toString(),
    academicYear: '2099-2100',
    student: ids.studentB._id,
    expectedRevision: attendance.revision,
  }, { _id: ids.teacherUser._id, role: 'teacher' });
  const updated = await Attendance.findById(attendance._id).lean();
  assert.strictEqual(updated.class, '5');
  assert.strictEqual(updated.subject, ids.subjectA.toString());
  assert.strictEqual(updated.academicYear, academicYear);
  assert.strictEqual(updated.student.toString(), ids.studentA._id.toString());

  await assert.rejects(
    attendanceService.updateAttendance(attendance._id, { status: 'Absent', expectedRevision: updated.revision }, {
      _id: ids.otherTeacherUser._id,
      role: 'teacher',
    }),
    (error) => expectStatus(error, 403)
  );

  const indexes = await Attendance.collection.indexes();
  const compound = indexes.find((index) =>
    index.unique &&
    index.key.student === 1 &&
    index.key.class === 1 &&
    index.key.date === 1 &&
    index.key.subject === 1 &&
    index.key.academicYear === 1
  );
  assert(compound, 'Compound unique attendance index must exist');

  await assert.rejects(
    Attendance.create({
      student: ids.studentA._id,
      class: '5',
      date: attendance.date,
      subject: ids.subjectA.toString(),
      academicYear,
      markedBy: ids.teacherUser._id,
      status: 'Present',
    }),
    (error) => error.code === 11000
  );

  await Attendance.create({
    student: ids.studentA._id,
    class: '5',
    date: attendance.date,
    subject: ids.subjectA.toString(),
    academicYear: '2027-2028',
    markedBy: ids.teacherUser._id,
    status: 'Present',
  });
  assert.strictEqual(await Attendance.countDocuments({ student: ids.studentA._id }), 2);
  console.log('PASS persisted update authorization and index integrity checks');
}

async function testConcurrentUpserts() {
  const concurrentDate = '2026-11-03';
  const payload = {
    class: '5',
    date: concurrentDate,
    academicYear,
    subject: ids.subjectA.toString(),
    attendanceData: [{ student: ids.studentA._id, status: 'Present', expectedRevision: null }],
  };
  const results = await Promise.allSettled([
    attendanceService.markBulkAttendance(payload, { _id: ids.teacherUser._id, role: 'teacher' }),
    attendanceService.markBulkAttendance(payload, { _id: ids.teacherUser._id, role: 'teacher' }),
  ]);
  const failures = results.filter((result) => result.status === 'rejected');
  assert(failures.every((result) => result.reason.statusCode === 409 || result.reason.code === 11000),
    'Concurrent duplicate writes may only fail with duplicate-key protection');
  assert.strictEqual(await Attendance.countDocuments({
    student: ids.studentA._id,
    class: '5',
    subject: ids.subjectA.toString(),
    academicYear,
    date: {
      $gte: new Date('2026-11-02T00:00:00.000Z'),
      $lt: new Date('2026-11-04T00:00:00.000Z'),
    },
  }), 1, 'Concurrent upserts must leave one logical attendance record');
  console.log('PASS concurrent upsert uniqueness check');
}

async function testAuthenticationAndIsolation() {
  const active = await authService.login(ids.teacherUser.email, syntheticPassword, '127.0.0.1');
  assert(active._id.equals(ids.teacherUser._id));
  await assert.rejects(
    authService.login(ids.teacherUser.email, 'wrong-password', '127.0.0.1'),
    (error) => expectStatus(error, 401)
  );
  await assert.rejects(
    authService.login(ids.inactiveUser.email, syntheticPassword, '127.0.0.1'),
    (error) => expectStatus(error, 403)
  );

  const own = await attendanceService.getStudentAttendanceSummary(
    ids.studentA._id, academicYear, { _id: ids.studentUser._id, role: 'student' }
  );
  assert(own.total >= 1);
  await assert.rejects(
    attendanceService.getStudentAttendanceSummary(
      ids.studentB._id, academicYear, { _id: ids.studentUser._id, role: 'student' }
    ),
    (error) => expectStatus(error, 403) || expectStatus(error, 404)
  );
  await assert.rejects(
    attendanceService.getStudentAttendanceSummary(
      ids.studentA._id, academicYear, { _id: ids.unrelatedParentUser._id, role: 'parent' }
    ),
    (error) => expectStatus(error, 403) || expectStatus(error, 404)
  );

  const decoded = { id: ids.teacherUser._id };
  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../config/env');
  const token = jwt.sign(decoded, JWT_SECRET, { expiresIn: '5m' });
  const invokeProtect = (request) => new Promise((resolve) => {
    protect(request, {}, (error) => resolve(error || null));
  });
  assert.strictEqual((await invokeProtect({
    headers: { authorization: `Bearer ${token}` },
    cookies: {},
  })).statusCode, 401);
  assert.strictEqual(await invokeProtect({
    headers: {},
    cookies: { token },
  }), null);
  console.log('PASS authentication and authorization isolation checks');
}

async function testResetTokenStorage() {
  const user = await User.findById(ids.teacherUser._id).select('+password');
  const token = user.getResetPasswordToken();
  await user.save({ validateBeforeSave: false });
  const stored = await User.findById(user._id).select('+password resetPasswordToken resetPasswordExpire');
  assert.notStrictEqual(stored.resetPasswordToken, token);
  assert.strictEqual(stored.resetPasswordToken.length, 64);
  assert(stored.resetPasswordExpire > Date.now());
  await authService.resetPassword(token, 'Synthetic-New-Password-2026!');
  await assert.rejects(
    authService.resetPassword(token, 'Synthetic-Reuse-Password-2026!'),
    (error) => expectStatus(error, 400)
  );
  console.log('PASS password-reset hash, expiry, and single-use checks');
}

async function main() {
  assertSafeTestUri(TEST_URI);
  await mongoose.connect(TEST_URI, { autoIndex: true, autoCreate: true });
  assert(mongoose.connection.db.databaseName.startsWith(TEST_DATABASE_PREFIX));
  await mongoose.connection.dropDatabase();
  await mongoose.connection.syncIndexes();
  await seedFixtures();
  await AcademicYear.create({
    name: '2026-2027',
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2027-03-31T23:59:59.999Z'),
    isCurrent: true,
    isActive: true,
  });
  await testAttendanceAuthorization();
  await testAttendanceUpdatesAndIndexes();
  await testConcurrentUpserts();
  await testAuthenticationAndIsolation();
  await testResetTokenStorage();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(`All MongoDB integration tests passed against isolated database ${parsedUri.pathname.slice(1)}`);
}

main().catch(async (error) => {
  console.error(`MongoDB integration tests failed: ${error.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
