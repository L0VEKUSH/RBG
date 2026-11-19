'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const permissions = require('../config/permissions');
const { validationResult } = require('express-validator');
const { markAttendanceValidation } = require('../validators/attendance.validator');
const attendanceDate = require('../utils/attendance-date');

const root = path.join(__dirname, '..');
const serviceSource = fs.readFileSync(path.join(root, 'services/attendance.service.js'), 'utf8');

class TestError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function chain(value) {
  const query = {
    sessionValue: null,
    select() { return query; },
    populate() { return query; },
    sort() { return query; },
    lean() { return query; },
    session(value) { query.sessionValue = value; return query; },
    read() { return query; },
    readConcern() { return query; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
  return query;
}

function defaultModels() {
  const connection = {
    async startSession() {
      const session = {
        async withTransaction(callback) { return callback(session); },
        async endSession() {},
      };
      return session;
    },
  };
  const models = {
    Attendance: {
      getClassAttendance: async () => [],
      getStudentSummary: async () => ({ total: 0, percentage: 0 }),
      find: () => chain([]),
      findOne: () => chain(null),
      findOneAndUpdate: () => chain(null),
      aggregate: async () => [],
      bulkWrite: async () => ({ matchedCount: 0, upsertedCount: 0 }),
      findById: () => chain(null),
      findByIdAndUpdate: async () => null,
      collection: {
        indexes: async () => [
          { key: { student: 1, class: 1, date: 1, subject: 1, academicYear: 1 }, unique: true },
        ],
      },
    },
    Student: {
      CLASS_LEVELS: ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', ...Array.from({ length: 12 }, (_, i) => String(i + 1))],
      findById: () => chain(null),
      find: () => chain([]),
    },
    Faculty: { findOne: () => chain(null) },
    Parent: { findOne: () => chain(null) },
    SubjectAllocation: { find: () => chain([]), findOne: () => chain(null), exists: async () => false },
    Subject: { find: () => chain([]), findOne: () => chain(null) },
    AcademicYear: {
      findOne: () => chain({
        name: '2026-2027',
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        endDate: new Date('2027-03-31T00:00:00.000Z'),
      }),
    },
  };
  for (const model of Object.values(models)) model.db = connection;
  return models;
}

function loadAttendanceService(models = defaultModels()) {
  const modules = {
    '../models/Attendance': models.Attendance,
    '../models/Student': models.Student,
    '../models/Faculty': models.Faculty,
    '../models/Parent': models.Parent,
    '../models/SubjectAllocation': models.SubjectAllocation,
    '../models/Subject': models.Subject,
    '../models/AcademicYear': models.AcademicYear,
    '../config/permissions': permissions,
    '../utils/errorResponse': TestError,
    '../utils/logger': { info() {} },
    '../utils/attendance-date': attendanceDate,
    'node:crypto': crypto,
    mongoose,
  };
  const sandbox = {
    module: { exports: {} },
    require: id => {
      if (!Object.prototype.hasOwnProperty.call(modules, id)) throw new Error(`Unexpected import: ${id}`);
      return modules[id];
    },
    Set, Map, Promise, Date, String, Number, Object, Array, Math,
  };
  vm.runInNewContext(serviceSource, sandbox, { filename: 'attendance.service.js' });
  return sandbox.module.exports;
}

function actor(role, permissionsOverride = []) {
  return { _id: new mongoose.Types.ObjectId(), role, permissions: permissionsOverride };
}

function jsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

test('attendance date helpers enforce strict school-local date-only boundaries', () => {
  assert.equal(attendanceDate.parseSchoolDate('2026-11-05').value, '2026-11-05');
  assert.throws(() => attendanceDate.parseSchoolDate('2026-11-05T00:00:00Z'));
  assert.throws(() => attendanceDate.parseSchoolDate('2026-02-30'));
  const bounds = attendanceDate.schoolDayBounds('2026-11-05');
  assert.equal(bounds.start.toISOString(), '2026-11-04T18:30:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-11-05T18:30:00.000Z');
  const year = {
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2027-03-31T00:00:00.000Z'),
  };
  assert.equal(attendanceDate.isWithinAcademicYear('2026-04-01', year), true);
  assert.equal(attendanceDate.isWithinAcademicYear('2027-03-31', year), true);
  assert.equal(attendanceDate.isWithinAcademicYear('2026-03-31', year), false);
  assert.equal(attendanceDate.isWithinAcademicYear('2027-04-01', year), false);
});

test('class attendance reads require exact class/year assignment before lookup and return a Student allowlist', async () => {
  const teacher = actor('teacher');
  const facultyId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();
  const attendanceId = new mongoose.Types.ObjectId();
  let readArgs;
  let attendanceLookups = 0;
  const models = defaultModels();
  models.Faculty.findOne = () => chain({
    _id: facultyId,
    classTeacherOf: { class: '5', academicYear: '2026-2027' },
  });
  models.Student.find = () => chain([{
    _id: studentId,
    user: { name: 'Synthetic Student', phone: 'private' },
    admissionNumber: 'SYN-1', rollNumber: 1,
    class: '5', academicYear: '2026-2027',
    enrollmentEffectiveFrom: attendanceDate.schoolDayBounds('2026-04-01').start,
    enrollmentHistory: [],
    fees: { totalFees: 100000 },
    toObject() { return this; },
  }]);
  models.Attendance.getClassAttendance = async (...args) => {
    attendanceLookups += 1;
    readArgs = args;
    return [{
      _id: attendanceId,
      student: {
        _id: studentId,
        admissionNumber: 'SYN-1',
        rollNumber: 1,
        class: '6',
        academicYear: '2027-2028',
        user: { name: 'Synthetic Student', email: 'private@example.test' },
        fees: { totalFees: 100000 },
        father: { phone: 'synthetic-private' },
        medicalConditions: ['synthetic-private'],
        documents: [{ url: 'synthetic-private' }],
        parentUser: new mongoose.Types.ObjectId(),
      },
      class: '5',
      date: new Date('2026-11-05T00:00:00Z'),
      status: 'Present',
      subject: 'General',
      academicYear: '2026-2027',
      markedBy: new mongoose.Types.ObjectId(),
    }];
  };
  const service = loadAttendanceService(models);
  const result = await service.getClassAttendance('5', '2026-11-05', '2026-2027', teacher);
  assert.equal(attendanceLookups, 1);
  assert.equal(readArgs[0], '5');
  assert.equal(readArgs[2], '2026-2027');
  assert.equal(readArgs[3], null, 'class teachers can read all assigned class subjects');
  assert.deepEqual(Object.keys(result.records[0].student).sort(), ['_id', 'academicYear', 'admissionNumber', 'class', 'name', 'rollNumber'].sort());
  assert.equal(result.records[0].student.name, 'Synthetic Student');
  assert.equal(result.records[0].student.class, '5', 'historical DTO uses the attendance record class');
  assert.equal(result.records[0].student.academicYear, '2026-2027', 'historical DTO uses the attendance record year');
  assert.equal(Object.hasOwn(result.records[0].student, 'fees'), false);
  assert.equal(Object.hasOwn(result.records[0], 'markedBy'), false);
  assert.equal(result.students[0].name, 'Synthetic Student');

  await assert.rejects(
    service.getClassAttendance('5', '2025-11-05', '2025-2026', teacher),
    error => error.statusCode === 403
  );
  assert.equal(attendanceLookups, 1, 'a denied year is rejected before attendance lookup');
});

test('leadership class attendance reads also require an explicit academic year before attendance lookup', async () => {
  const principal = actor('principal');
  let lookups = 0;
  const models = defaultModels();
  models.Attendance.getClassAttendance = async () => { lookups += 1; return []; };
  const service = loadAttendanceService(models);

  await assert.rejects(service.getClassAttendance('5', '2026-11-05', undefined, principal), /academic year/i);
  await assert.rejects(service.getClassReport('5', '2026-11-01', '2026-11-30', undefined, principal), /academic year/i);
  assert.equal(lookups, 0);
});

test('subject-teacher reads are restricted to allocated subjects and custom-role direct calls fail closed', async () => {
  const teacher = actor('teacher');
  const facultyId = new mongoose.Types.ObjectId();
  const subjectId = new mongoose.Types.ObjectId();
  let filter;
  const models = defaultModels();
  models.Faculty.findOne = () => chain({ _id: facultyId, classTeacherOf: { class: '6', academicYear: '' } });
  models.SubjectAllocation.find = () => chain([{ subject: subjectId }]);
  models.Subject.find = () => chain([{ _id: subjectId, name: 'Science', code: 'SCI' }]);
  models.Attendance.getClassAttendance = async (...args) => { filter = args[3]; return []; };
  const service = loadAttendanceService(models);
  await service.getClassAttendance('6', '2026-11-05', '2026-2027', teacher);
  assert.deepEqual(jsonValue(filter), [String(subjectId), 'Science', 'SCI']);

  let lookups = 0;
  models.Attendance.getClassAttendance = async () => { lookups += 1; return []; };
  const directService = loadAttendanceService(models);
  await assert.rejects(
    directService.getClassAttendance('6', '2026-11-05', '2026-2027', actor('custom_role', ['attendance.view'])),
    error => error.statusCode === 403
  );
  assert.equal(lookups, 0);
});

test('student identity, current parent links, and legacy parentUser links are checked before attendance queries', async () => {
  const studentUser = actor('student');
  const parentUser = actor('parent');
  const studentId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();
  let summaryQueries = 0;
  let parentChildren = [];
  let legacyParent = null;
  const models = defaultModels();
  models.Student.findById = () => chain({
    _id: studentId,
    user: studentUser._id,
    class: '5',
    academicYear: '2026-2027',
    enrollmentHistory: [],
    parentUser: legacyParent,
  });
  models.Parent.findOne = () => chain({ children: parentChildren });
  models.Attendance.getStudentSummary = async () => { summaryQueries += 1; return { total: 1, percentage: 100 }; };
  const service = loadAttendanceService(models);

  await service.getStudentAttendanceSummary(studentId, '2026-2027', studentUser);
  await assert.rejects(
    service.getStudentAttendanceSummary(studentId, '2026-2027', { ...studentUser, _id: otherUserId }),
    error => error.statusCode === 404
  );
  parentChildren = [studentId];
  await service.getStudentAttendanceSummary(studentId, '2026-2027', parentUser);
  parentChildren = [];
  legacyParent = parentUser._id;
  await service.getStudentAttendanceSummary(studentId, '2026-2027', parentUser);
  legacyParent = otherUserId;
  await assert.rejects(
    service.getStudentAttendanceSummary(studentId, '2026-2027', parentUser),
    error => error.statusCode === 404
  );
  assert.equal(summaryQueries, 3, 'only self or explicitly linked requests reach the attendance aggregate');
});

test('teacher historical reads require both the historical enrollment and matching year assignment', async () => {
  const teacher = actor('class_teacher');
  const facultyId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();
  let attendanceFilter;
  const models = defaultModels();
  models.AcademicYear.findOne = ({ name }) => chain({
    name,
    startDate: new Date('2025-04-01T00:00:00.000Z'),
    endDate: new Date('2026-03-31T00:00:00.000Z'),
  });
  models.Student.findById = () => chain({
    _id: studentId,
    user: new mongoose.Types.ObjectId(),
    class: '6',
    academicYear: '2026-2027',
    enrollmentHistory: [{
      class: '5', academicYear: '2025-2026', rollNumber: 8,
      effectiveFrom: new Date('2025-04-01T00:00:00.000Z'),
      promotedDate: new Date('2026-04-01T00:00:00.000Z'),
    }],
  });
  models.Faculty.findOne = () => chain({ _id: facultyId, classTeacherOf: { class: '5', academicYear: '2025-2026' } });
  models.Attendance.find = filter => {
    attendanceFilter = filter;
    return chain([{
      _id: new mongoose.Types.ObjectId(), student: studentId, class: '5',
      academicYear: '2025-2026', date: attendanceDate.schoolDayBounds('2025-06-15').start,
      status: 'Present', subject: 'General',
    }]);
  };
  const service = loadAttendanceService(models);
  const summary = await service.getStudentAttendanceSummary(studentId, '2025-2026', teacher);
  assert.equal(summary.Present, 1);
  assert.equal(summary.total, 1);
  assert.equal(attendanceFilter.academicYear, '2025-2026');
  assert.equal(attendanceFilter.$or[0].class, '5');
  assert.ok(attendanceFilter.$or[0].date.$gte instanceof Date);

  models.Faculty.findOne = () => chain({ _id: facultyId, classTeacherOf: { class: '5', academicYear: '2026-2027' } });
  await assert.rejects(
    service.getStudentAttendanceSummary(studentId, '2025-2026', teacher),
    error => error.statusCode === 404
  );
});

test('marking requires a year-specific assignment and date-effective enrollment; actor and identity fields are server-derived', async () => {
  const teacher = actor('class_teacher');
  const facultyId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();
  let enrollmentFilter;
  let enrollmentQuery;
  let facultyQuery;
  let yearQuery;
  let bulkOperations;
  let bulkOptions;
  const models = defaultModels();
  models.Faculty.findOne = () => {
    facultyQuery = chain({
    _id: facultyId,
    classTeacherOf: { class: '5', academicYear: '2026-2027' },
    });
    return facultyQuery;
  };
  models.AcademicYear.findOne = () => {
    yearQuery = chain({
      name: '2026-2027',
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
    });
    return yearQuery;
  };
  const date = attendanceDate.todaySchoolDate();
  models.Student.find = query => {
    enrollmentFilter = query;
    enrollmentQuery = chain([{
      _id: studentId, class: '5', academicYear: '2026-2027', isActive: true,
      enrollmentEffectiveFrom: attendanceDate.schoolDayBounds('2026-04-01').start,
      enrollmentHistory: [],
    }]);
    return enrollmentQuery;
  };
  models.Attendance.bulkWrite = async (operations, options) => {
    bulkOperations = operations;
    bulkOptions = options;
    return { matchedCount: 1, upsertedCount: 0 };
  };
  const service = loadAttendanceService(models);
  await service.markBulkAttendance({
    class: '5',
    date,
    academicYear: '2026-2027',
    subject: 'General',
    markedBy: new mongoose.Types.ObjectId(),
    createdAt: new Date(),
    attendanceData: [{ student: studentId, status: 'Present', expectedRevision: 0, markedBy: 'spoof' }],
  }, teacher);
  assert.equal(enrollmentFilter.isActive, true);
  assert.deepEqual(jsonValue(enrollmentFilter._id.$in), [String(studentId)]);
  assert.ok(facultyQuery.sessionValue, 'assignment read uses the transaction session');
  assert.ok(yearQuery.sessionValue, 'academic-year read uses the transaction session');
  assert.ok(enrollmentQuery.sessionValue, 'student enrollment read uses the transaction session');
  assert.ok(bulkOptions.session, 'bulk writes use the transaction session');
  const operation = bulkOperations[0].updateOne;
  assert.equal(operation.filter.academicYear, '2026-2027');
  assert.equal(operation.update.$inc.revision, 1);
  assert.equal(operation.update.$set.markedBy, teacher._id);
  assert.equal(operation.update.$set.status, 'Present');
  assert.equal(Object.hasOwn(operation.update.$set, 'createdAt'), false);
  assert.equal(Object.hasOwn(operation.update.$set, 'student'), false);

  const yearlessModels = defaultModels();
  yearlessModels.Faculty.findOne = () => chain({ _id: facultyId, classTeacherOf: { class: '5' } });
  let wrote = false;
  yearlessModels.Attendance.bulkWrite = async () => { wrote = true; };
  await assert.rejects(
    loadAttendanceService(yearlessModels).markBulkAttendance({
      class: '5', date, academicYear: '2026-2027', subject: 'General',
      attendanceData: [{ student: studentId, status: 'Present', expectedRevision: 0 }],
    }, teacher),
    error => error.statusCode === 403
  );
  assert.equal(wrote, false);
});

test('a create request with no expected revision cannot overwrite a record created after the roster read', async () => {
  const teacher = actor('class_teacher');
  const facultyId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();
  let operation;
  const models = defaultModels();
  models.Faculty.findOne = () => chain({ _id: facultyId, classTeacherOf: { class: '5', academicYear: '2026-2027' } });
  models.Student.find = () => chain([{
    _id: studentId, class: '5', academicYear: '2026-2027', isActive: true,
    enrollmentEffectiveFrom: attendanceDate.schoolDayBounds('2026-04-01').start,
    enrollmentHistory: [],
  }]);
  models.Attendance.bulkWrite = async operations => {
    operation = operations[0].updateOne;
    const duplicate = new Error('synthetic unique-key conflict');
    duplicate.code = 11000;
    throw duplicate;
  };
  await assert.rejects(
    loadAttendanceService(models).markBulkAttendance({
      class: '5', date: attendanceDate.todaySchoolDate(), academicYear: '2026-2027', subject: 'General',
      attendanceData: [{ student: studentId, status: 'Present', expectedRevision: null }],
    }, teacher),
    error => error.statusCode === 409
  );
  assert.equal(operation.filter._id.$exists, false);
  assert.equal(operation.upsert, true);
});

test('missing and overlapping enrollment dates fail closed and promotion date starts the new class', async () => {
  const teacher = actor('class_teacher');
  const facultyId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();
  const models = defaultModels();
  models.Faculty.findOne = () => chain({ _id: facultyId, classTeacherOf: { class: '5', academicYear: '2026-2027' } });
  let studentRecord = {
    _id: studentId, class: '5', academicYear: '2026-2027', isActive: true,
    enrollmentHistory: [],
  };
  models.Student.find = () => chain([studentRecord]);
  let writes = 0;
  models.Attendance.bulkWrite = async () => { writes += 1; return { matchedCount: 0, upsertedCount: 1 }; };
  const service = loadAttendanceService(models);
  const request = date => service.markBulkAttendance({
    class: '5', date, academicYear: '2026-2027', subject: 'General',
    attendanceData: [{ student: studentId, status: 'Present', expectedRevision: null }],
  }, teacher);

  await assert.rejects(request(attendanceDate.todaySchoolDate()), error => error.statusCode === 403);
  assert.equal(writes, 0);

  studentRecord = {
    ...studentRecord,
    class: '6',
    enrollmentEffectiveFrom: attendanceDate.schoolDayBounds('2026-05-01').start,
    enrollmentHistory: [{
      class: '5', academicYear: '2026-2027',
      effectiveFrom: attendanceDate.schoolDayBounds('2026-04-01').start,
      promotedDate: attendanceDate.schoolDayBounds('2026-06-01').start,
    }],
  };
  await assert.rejects(request('2026-04-30'), error => error.statusCode === 403);
  assert.equal(writes, 0, 'overlapping enrollment intervals are ambiguous');

  studentRecord = {
    ...studentRecord,
    enrollmentEffectiveFrom: attendanceDate.schoolDayBounds('2026-06-01').start,
  };
  await request('2026-05-31');
  assert.equal(writes, 1, 'the previous class remains valid through the day before promotion');
  await assert.rejects(request('2026-06-01'), error => error.statusCode === 403);
  assert.equal(writes, 1, 'the previous class is not valid on the promotion effective date');
});

test('an uncertain batch commit reports success only after exact majority read-back', async () => {
  const teacher = actor('class_teacher');
  const facultyId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();
  const models = defaultModels();
  models.Faculty.findOne = () => chain({ _id: facultyId, classTeacherOf: { class: '5', academicYear: '2026-2027' } });
  models.Student.find = () => chain([{
    _id: studentId, class: '5', academicYear: '2026-2027', isActive: true,
    enrollmentEffectiveFrom: attendanceDate.schoolDayBounds('2026-04-01').start,
    enrollmentHistory: [],
  }]);
  let write;
  models.Attendance.bulkWrite = async operations => {
    write = operations[0].updateOne;
    return { matchedCount: 0, upsertedCount: 1 };
  };
  models.Attendance.find = filter => {
    assert.ok(filter.lastMutationId);
    const inserted = write.update.$setOnInsert;
    assert.equal(filter.lastMutationId, inserted.lastMutationId);
    return chain([inserted]);
  };
  models.Attendance.db.startSession = async () => {
    const session = {
      async withTransaction(callback) {
        await callback(session);
        const unknown = new Error('synthetic unknown commit result');
        unknown.errorLabels = ['UnknownTransactionCommitResult'];
        throw unknown;
      },
      async endSession() {},
    };
    return session;
  };
  const result = await loadAttendanceService(models).markBulkAttendance({
    class: '5', date: attendanceDate.todaySchoolDate(), academicYear: '2026-2027', subject: 'General',
    attendanceData: [{ student: studentId, status: 'Present', expectedRevision: null }],
  }, teacher);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].revision, 1);
});

test('attendance writes fail closed when the compound unique index does not enforce every record', async () => {
  const teacher = actor('class_teacher');
  const studentId = new mongoose.Types.ObjectId();
  let writes = 0;
  const models = defaultModels();
  models.Attendance.collection.indexes = async () => [{
    key: { student: 1, class: 1, date: 1, subject: 1, academicYear: 1 },
    unique: true,
    partialFilterExpression: { isActive: true },
  }];
  models.Attendance.bulkWrite = async () => { writes += 1; return {}; };
  await assert.rejects(
    loadAttendanceService(models).markBulkAttendance({
      class: '5', date: attendanceDate.todaySchoolDate(), academicYear: '2026-2027', subject: 'General',
      attendanceData: [{ student: studentId, status: 'Present', expectedRevision: null }],
    }, teacher),
    error => error.statusCode === 503
  );
  assert.equal(writes, 0);

  models.Attendance.collection.indexes = async () => [
    { key: { student: 1, class: 1, date: 1, subject: 1, academicYear: 1 }, unique: true },
    { key: { student: 1, date: 1, subject: 1 }, unique: true },
  ];
  await assert.rejects(
    loadAttendanceService(models).markBulkAttendance({
      class: '5', date: attendanceDate.todaySchoolDate(), academicYear: '2026-2027', subject: 'General',
      attendanceData: [{ student: studentId, status: 'Present', expectedRevision: null }],
    }, teacher),
    error => error.statusCode === 503
  );
  assert.equal(writes, 0, 'an incompatible narrow unique index blocks writes');
});

test('unsupported transaction topology fails closed without a non-transactional write fallback', async () => {
  const teacher = actor('class_teacher');
  const studentId = new mongoose.Types.ObjectId();
  let writes = 0;
  const models = defaultModels();
  models.Attendance.db.startSession = async () => ({
    async withTransaction() {
      const unsupported = new Error('Transaction numbers are only allowed on a replica set member or mongos');
      unsupported.code = 20;
      throw unsupported;
    },
    async endSession() {},
  });
  models.Attendance.bulkWrite = async () => { writes += 1; return {}; };
  await assert.rejects(
    loadAttendanceService(models).markBulkAttendance({
      class: '5', date: attendanceDate.todaySchoolDate(), academicYear: '2026-2027', subject: 'General',
      attendanceData: [{ student: studentId, status: 'Present', expectedRevision: null }],
    }, teacher),
    error => error.statusCode === 503 && error.code === 'ATTENDANCE_TRANSACTIONS_UNAVAILABLE'
  );
  assert.equal(writes, 0);
});

test('invalid student IDs, duplicate students, mismatched enrollment, and invalid statuses do not write', async () => {
  const teacher = actor('class_teacher');
  const facultyId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();
  let writes = 0;
  const models = defaultModels();
  models.Faculty.findOne = () => chain({ _id: facultyId, classTeacherOf: { class: '5', academicYear: '2026-2027' } });
  models.AcademicYear.exists = async () => true;
  models.Student.find = () => chain([]);
  models.Attendance.bulkWrite = async () => { writes += 1; };
  const service = loadAttendanceService(models);
  const base = { class: '5', date: attendanceDate.todaySchoolDate(), academicYear: '2026-2027', subject: 'General' };

  for (const attendanceData of [
    [{ student: 'malformed', status: 'Present' }],
    [{ student: studentId, status: 'Present', expectedRevision: 0 }, { student: studentId, status: 'Absent', expectedRevision: 0 }],
    [{ student: studentId, status: 'Pending', expectedRevision: 0 }],
  ]) {
    await assert.rejects(service.markBulkAttendance({ ...base, attendanceData }, teacher));
  }
  await assert.rejects(
    service.markBulkAttendance({ ...base, attendanceData: [{ student: studentId, status: 'Present', expectedRevision: 0 }] }, teacher),
    error => error.statusCode === 403
  );
  assert.equal(writes, 0);
});

test('attendance update requires permission and cannot alter identity or audit fields', async () => {
  const teacher = actor('class_teacher');
  const facultyId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();
  const attendanceId = new mongoose.Types.ObjectId();
  let update;
  let writes = 0;
  const models = defaultModels();
  models.Faculty.findOne = () => chain({ _id: facultyId, classTeacherOf: { class: '5', academicYear: '2026-2027' } });
  const today = attendanceDate.todaySchoolDate();
  models.Attendance.findById = () => chain({
    _id: attendanceId, student: studentId, class: '5', subject: 'General', academicYear: '2026-2027',
    date: attendanceDate.schoolDayBounds(today).start, status: 'Present', revision: 0,
  });
  models.Student.findById = () => chain({
    _id: studentId, class: '5', academicYear: '2026-2027',
    enrollmentEffectiveFrom: attendanceDate.schoolDayBounds('2026-04-01').start,
    enrollmentHistory: [],
  });
  models.Attendance.findOneAndUpdate = (filter, updateDocument) => {
    writes += 1;
    update = updateDocument;
    return chain({
      _id: attendanceId, student: studentId, class: '5', subject: 'General',
      academicYear: '2026-2027', date: attendanceDate.schoolDayBounds(today).start,
      status: 'Late', revision: 1,
    });
  };
  const service = loadAttendanceService(models);
  const result = await service.updateAttendance(attendanceId, {
    status: 'Late', expectedRevision: 0, class: '99', student: new mongoose.Types.ObjectId(), academicYear: '2099-2100',
    markedBy: new mongoose.Types.ObjectId(), createdAt: new Date(), lockStatus: 'approved',
  }, teacher);
  assert.deepEqual(Object.keys(update.$set).sort(), ['lastMutationId', 'markedBy', 'remarks', 'status']);
  assert.equal(update.$inc.revision, 1);
  assert.equal(update.$set.markedBy, teacher._id);
  assert.equal(result.status, 'Late');
  assert.equal(Object.hasOwn(result, 'markedBy'), false);

  models.Attendance.findById = () => chain({
    _id: attendanceId, student: studentId, class: '5', subject: 'General', academicYear: '2026-2027',
    date: attendanceDate.schoolDayBounds(today).start, status: 'Late', revision: 1,
  });
  await assert.rejects(
    service.updateAttendance(attendanceId, { status: 'Absent', expectedRevision: 0 }, teacher),
    error => error.statusCode === 409
  );
  assert.equal(writes, 1, 'a stale revision is rejected before persistence');

  await assert.rejects(
    service.updateAttendance(attendanceId, { status: 'Absent', expectedRevision: 0 }, actor('teacher', ['-attendance.edit-authorized'])),
    error => error.statusCode === 403
  );
  assert.equal(writes, 1);
});

test('teacher reports require assigned class/year and server-derive aggregate filters', async () => {
  const teacher = actor('teacher', ['attendance.report']);
  const facultyId = new mongoose.Types.ObjectId();
  let recordFilter;
  const models = defaultModels();
  models.Faculty.findOne = () => chain({ _id: facultyId, classTeacherOf: { class: '5', academicYear: '2026-2027' } });
  const studentId = new mongoose.Types.ObjectId();
  models.Attendance.find = filter => {
    recordFilter = filter;
    return chain([{
      student: studentId, class: '5', academicYear: '2026-2027', subject: 'General', status: 'Present',
      date: attendanceDate.schoolDayBounds('2026-11-05').start,
    }]);
  };
  models.Student.find = () => chain([{
    _id: studentId, class: '5', academicYear: '2026-2027',
    enrollmentEffectiveFrom: attendanceDate.schoolDayBounds('2026-04-01').start,
    enrollmentHistory: [],
  }]);
  const service = loadAttendanceService(models);
  await assert.rejects(service.getAttendanceReport({}, teacher), error => error.statusCode === 400);
  const result = await service.getAttendanceReport({
    class: '5', academicYear: '2026-2027', $where: 'synthetic-injection', unknown: 'ignored',
  }, teacher);
  assert.deepEqual(jsonValue(recordFilter), { class: '5', academicYear: '2026-2027' });
  assert.deepEqual(jsonValue(result), [{ _id: 'Present', count: 1 }]);
});

test('leadership low-attendance results contain only a minimal historical roster DTO', async () => {
  const principal = actor('principal');
  const studentId = new mongoose.Types.ObjectId();
  const models = defaultModels();
  models.Student.find = () => chain([{
    _id: studentId,
    user: { name: 'Synthetic Student', phone: 'private', email: 'private@example.test' },
    admissionNumber: 'SYN-2', rollNumber: 2, class: '5', academicYear: '2026-2027',
    enrollmentEffectiveFrom: attendanceDate.schoolDayBounds('2026-04-01').start,
    father: { phone: 'private' }, fees: { paidFees: 500 }, medicalConditions: ['private'],
    enrollmentHistory: [],
    toObject() { return this; },
  }]);
  models.Attendance.getStudentSummary = async () => ({ total: 10, percentage: 50 });
  const results = await loadAttendanceService(models).getLowAttendanceStudents('5', '2026-2027', 75, principal);
  assert.equal(results.length, 1);
  assert.deepEqual(Object.keys(results[0].student).sort(), ['_id', 'academicYear', 'admissionNumber', 'class', 'name', 'rollNumber'].sort());
  assert.equal(results[0].student.name, 'Synthetic Student');
});

test('historical class reports use the matching enrollment-history roster and academic-year filter', async () => {
  const principal = actor('principal');
  const studentId = new mongoose.Types.ObjectId();
  let rosterFilter;
  let attendanceFilter;
  const models = defaultModels();
  models.Student.find = filter => {
    rosterFilter = filter;
    return chain([{
      _id: studentId,
      user: { name: 'Synthetic Former Class 5 Student' },
      admissionNumber: 'SYN-5',
      rollNumber: 12,
      class: '6',
      academicYear: '2026-2027',
       enrollmentHistory: [{
         class: '5', academicYear: '2025-2026', rollNumber: 9,
         effectiveFrom: new Date('2025-04-01T00:00:00.000Z'),
         promotedDate: new Date('2026-04-01T00:00:00.000Z'),
       }],
      toObject() { return this; },
    }]);
  };
  models.AcademicYear.findOne = query => chain(query.name === '2025-2026' ? {
    name: '2025-2026',
    startDate: new Date('2025-04-01T00:00:00.000Z'),
    endDate: new Date('2026-03-31T00:00:00.000Z'),
  } : null);
  models.Attendance.find = filter => {
    attendanceFilter = filter;
    return chain([{
      student: studentId,
      class: '5',
      academicYear: '2025-2026',
      date: attendanceDate.schoolDayBounds('2025-10-01').start,
      status: 'Present',
    }]);
  };
  const reports = await loadAttendanceService(models).getClassReport(
    '5', '2025-09-01', '2026-03-01', '2025-2026', principal
  );
  assert.equal(rosterFilter.$or[1].enrollmentHistory.$elemMatch.academicYear, '2025-2026');
  assert.deepEqual(jsonValue(attendanceFilter), {
    class: '5', academicYear: '2025-2026',
    date: { $gte: '2025-08-31T18:30:00.000Z', $lt: '2026-03-01T18:30:00.000Z' },
  });
  assert.equal(reports[0].student.name, 'Synthetic Former Class 5 Student');
  assert.equal(reports[0].student.rollNumber, 9);
});

test('unscoped roster and enrollment helpers are not exported as callable service methods', () => {
  const service = loadAttendanceService();
  assert.equal(service.getClassYearRoster, undefined);
  assert.equal(service.assertStudentsBelongToClass, undefined);
});

test('HTTP attendance validator accepts school date-only values and rejects invalid date formats', async () => {
  async function errorsFor(className, date = '2026-11-05') {
    const req = { body: {
      class: className,
      date,
      academicYear: '2026-2027',
      attendanceData: [{ student: new mongoose.Types.ObjectId().toString(), status: 'Present', expectedRevision: null }],
    } };
    await Promise.all(markAttendanceValidation.map(validation => validation.run(req)));
    return validationResult(req).array();
  }

  assert.deepEqual((await errorsFor('Pre-Nursery')).map(error => error.msg), []);
  assert.deepEqual((await errorsFor('UKG')).map(error => error.msg), []);
  assert.ok((await errorsFor('13')).some(error => error.msg === 'Invalid class'));
  assert.ok((await errorsFor('5', '2026-02-30')).some(error => error.msg === 'Date must be a valid YYYY-MM-DD school date'));
  assert.ok((await errorsFor('5', '2026-11-05T00:00:00.000Z')).some(error => error.msg === 'Date must be a valid YYYY-MM-DD school date'));
});

function createElement() {
  return {
    value: '', innerHTML: '', textContent: '', disabled: false,
    options: { length: 1 },
    parentElement: null,
    add() {},
  };
}

function loadPortalScript(relativePath, apiFetch) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    querySelector() { return createElement(); },
    querySelectorAll() { return []; },
  };
  const successes = [];
  const errors = [];
  const context = {
    window: {}, document, apiFetch, initPortal() {}, loadNoticesFull() {},
    cspActionAttrs: () => '', cspSetVisibility() {}, cspSetProgress() {},
    setButtonLoading() {}, setEmptyState(element, _icon, title, message) {
      element.textContent = `${title}: ${message}`;
    },
    showNetworkError() {}, toast: {
      success: (...args) => successes.push(args),
      error: (...args) => errors.push(args),
    },
    Date, Intl, Number, String, JSON, Array, Object, Math, Option: function Option() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    getInitials: () => 'S',
    formatCurrency: value => String(value),
  };
  vm.runInNewContext(source, context, { filename: relativePath });
  return { context, elements, successes, errors, getElementById: id => document.getElementById(id) };
}

test('teacher portal uses canonical roster and mark contracts and reports only confirmed success', async () => {
  const calls = [];
  const portal = loadPortalScript('public/js/teacher-portal.js', async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith('/attendance/class/')) return { success: true, data: {
      students: [{ _id: 'student-synthetic', rollNumber: 3, name: 'Synthetic Student' }],
      records: [],
    } };
    if (url === '/attendance/mark') return { success: true, data: { result: { records: [
      { studentId: 'student-synthetic', status: 'Late', revision: 1 },
    ] } } };
    throw new Error(`Unexpected endpoint ${url}`);
  });
  vm.runInNewContext("_attendanceScopes = [{ class: '5', academicYear: '2026-2027', isClassTeacher: true, subjects: [] }]", portal.context);
  portal.getElementById('attClassSel').value = '5';
  portal.getElementById('attAcademicYearSel').value = '2026-2027';
  portal.getElementById('attSubjectSel').value = 'General';
  portal.getElementById('attDateSel').value = '2026-11-05';
  await portal.context.window.loadClassRosterForAttendance();
  vm.runInNewContext("_attRoster[0].status = 'late'", portal.context);
  await portal.context.window.saveAttendance();

  const attendanceRead = calls.find(call => call.url.startsWith('/attendance/class/'));
  assert.match(attendanceRead.url, /date=2026-11-05/);
  assert.match(attendanceRead.url, /academicYear=2026-2027/);
  assert.match(attendanceRead.url, /subject=General/);
  assert.equal(calls.some(call => call.url.startsWith('/students/class/')), false);
  const markCall = calls.find(call => call.url === '/attendance/mark');
  const body = JSON.parse(markCall.options.body);
  assert.deepEqual(Object.keys(body).sort(), ['academicYear', 'attendanceData', 'class', 'date', 'subject'].sort());
  assert.deepEqual(body.attendanceData, [{ student: 'student-synthetic', status: 'Late', expectedRevision: null }]);
  assert.equal(body.subject, 'General');
  assert.equal(portal.successes.length, 1);
});

test('teacher portal does not show success for an unconfirmed API response', async () => {
  const portal = loadPortalScript('public/js/teacher-portal.js', async url => {
    if (url.startsWith('/attendance/class/')) return { success: true, data: {
      students: [{ _id: 'student-synthetic', name: 'Synthetic' }], records: [],
    } };
    if (url === '/attendance/mark') return { success: false };
    throw new Error(`Unexpected endpoint ${url}`);
  });
  vm.runInNewContext("_attendanceScopes = [{ class: '5', academicYear: '2026-2027', isClassTeacher: true, subjects: [] }]", portal.context);
  portal.getElementById('attClassSel').value = '5';
  portal.getElementById('attAcademicYearSel').value = '2026-2027';
  portal.getElementById('attSubjectSel').value = 'General';
  portal.getElementById('attDateSel').value = '2026-11-05';
  await portal.context.window.loadClassRosterForAttendance();
  await portal.context.window.saveAttendance();
  assert.equal(portal.successes.length, 0);
  assert.equal(portal.errors.length, 1);
});

test('teacher portal treats a success envelope without every committed revision as uncertain', async () => {
  const calls = [];
  const portal = loadPortalScript('public/js/teacher-portal.js', async url => {
    calls.push(url);
    if (url.startsWith('/attendance/class/')) return { success: true, data: {
      students: [{ _id: 'student-synthetic', name: 'Synthetic' }], records: [],
    } };
    if (url === '/attendance/mark') return { success: true, data: {} };
    throw new Error(`Unexpected endpoint ${url}`);
  });
  vm.runInNewContext("_attendanceScopes = [{ class: '5', academicYear: '2026-2027', isClassTeacher: true, subjects: [] }]", portal.context);
  portal.getElementById('attClassSel').value = '5';
  portal.getElementById('attAcademicYearSel').value = '2026-2027';
  portal.getElementById('attSubjectSel').value = 'General';
  portal.getElementById('attDateSel').value = '2026-11-05';
  await portal.context.window.loadClassRosterForAttendance();
  await portal.context.window.saveAttendance();
  assert.equal(portal.successes.length, 0);
  assert.equal(portal.errors.length, 1);
  assert.equal(calls.filter(url => url.startsWith('/attendance/class/')).length, 2, 'uncertain response triggers a reload for reconciliation');
});

test('subject teachers can select only a dashboard-assigned subject and submit its ID', async () => {
  const calls = [];
  const portal = loadPortalScript('public/js/teacher-portal.js', async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith('/attendance/class/')) return { success: true, data: {
      students: [{ _id: 'student-synthetic', name: 'Synthetic' }], records: [],
    } };
    if (url === '/attendance/mark') return { success: true, data: { result: { records: [
      { studentId: 'student-synthetic', status: 'Present', revision: 1 },
    ] } } };
    throw new Error(`Unexpected endpoint ${url}`);
  });
  vm.runInNewContext("_attendanceScopes = [{ class: '5', academicYear: '2026-2027', isClassTeacher: false, subjects: [{ id: 'subject-synthetic', label: 'Science <script>' }] }]", portal.context);
  portal.getElementById('attClassSel').value = '5';
  portal.getElementById('attAcademicYearSel').value = '2026-2027';
  portal.context.window.updateAttendanceSubjects();
  assert.match(portal.getElementById('attSubjectSel').innerHTML, /Science &lt;script&gt;/);
  portal.getElementById('attSubjectSel').value = 'subject-synthetic';
  portal.getElementById('attDateSel').value = '2026-11-05';
  await portal.context.window.loadClassRosterForAttendance();
  await portal.context.window.saveAttendance();
  const markCall = calls.find(call => call.url === '/attendance/mark');
  assert.equal(JSON.parse(markCall.options.body).subject, 'subject-synthetic');
  assert.equal(portal.successes.length, 1);
});

test('student and parent attendance pages use the canonical route and schema status casing', async () => {
  for (const [file, role] of [
    ['public/js/student-portal.js', 'student'],
    ['public/js/parent-portal.js', 'parent'],
  ]) {
    const calls = [];
    const portal = loadPortalScript(file, async url => {
      calls.push(url);
      return { success: true, data: { records: [
        { date: '2026-11-05T00:00:00.000Z', status: 'Present' },
        { date: '2026-11-06T00:00:00.000Z', status: 'Late' },
        { date: '2026-11-07T00:00:00.000Z', status: 'Absent' },
      ] } };
    });
    portal.getElementById('attMonthSel').value = '2026-11';
    if (role === 'student') vm.runInNewContext("_studentId = 'student-synthetic'", portal.context);
    else vm.runInNewContext("_activeChildId = 'child-synthetic'", portal.context);
    await portal.context.window.onPanel_attendance();
    assert.equal(calls[0], role === 'student'
      ? '/attendance/student/student-synthetic/monthly?year=2026&month=11'
      : '/attendance/student/child-synthetic/monthly?year=2026&month=11');
    const stats = portal.getElementById('attStats').innerHTML;
    assert.match(stats, /66\.7%/);
    assert.match(stats, /<div class="stat-value">1<\/div><div class="stat-label">Present/);
    assert.match(stats, /<div class="stat-value">1<\/div><div class="stat-label">Absent/);
    assert.match(stats, /<div class="stat-value">1<\/div><div class="stat-label">Late/);
  }
});

test('student dashboard calculates from authenticated Student ID, class, and academic year', async () => {
  const studentId = new mongoose.Types.ObjectId();
  let summaryArgs;
  const modelMap = {
    '../models/Student': { CLASS_LEVELS: ['1','2','3','4','5','6','7','8','9','10','11','12','Nursery','KG-1','KG-2'], findOne: () => chain({
      _id: studentId, class: '5', academicYear: '2026-2027',
      user: { name: 'Synthetic Student' },
    }).populate('user', 'name profilePhoto') },
    '../models/Faculty': {}, '../models/User': {}, '../models/Payment': {},
    '../models/Admission': {}, '../models/Homework': { countDocuments: async () => 0 },
    '../models/LibraryTransaction': {}, '../models/LibraryBook': {},
    '../models/Attendance': { getStudentSummary: async (...args) => {
      summaryArgs = args;
      return { total: 10, percentage: 80 };
    } },
    '../models/Class': {}, '../models/Parent': {}, '../models/SubjectAllocation': {},
    '../models/Timetable': { findOne: () => chain(null) },
    '../models/Exam': { findOne: () => chain(null) },
    '../utils/academic-year': require('../utils/academic-year'),
    '../utils/exam-visibility': require('../utils/exam-visibility'),
    '../utils/attendance-date': require('../utils/attendance-date'),
  };
  const dashboardSource = fs.readFileSync(path.join(root, 'services/dashboard.service.js'), 'utf8');
  const sandbox = {
    exports: {}, module: { exports: {} },
    require: id => modelMap[id] || (() => { throw new Error(`Unexpected import ${id}`); })(),
    Promise, Date, String, Number, Math, Set, Map, Object, Array,  };
  vm.runInNewContext(dashboardSource, sandbox, { filename: 'dashboard.service.js' });
  const result = await sandbox.exports.getStudentDashboard(new mongoose.Types.ObjectId());
  assert.deepEqual(summaryArgs, [studentId, '2026-2027', '5']);
  assert.equal(result.studentId, String(studentId));
  assert.equal(result.attendancePercentage, 80);
});

test('teacher dashboard exposes year-specific subject IDs and labels for attendance selection', async () => {
  const facultyId = new mongoose.Types.ObjectId();
  const subjectId = new mongoose.Types.ObjectId();
  const dashboardSource = fs.readFileSync(path.join(root, 'services/dashboard.service.js'), 'utf8');
  const modelMap = {
    '../models/Student': {},
    '../models/Faculty': { findOne: () => chain({
      _id: facultyId,
      user: { name: 'Synthetic Teacher' },
      classTeacherOf: { class: '4', academicYear: '' },
    }) },
    '../models/User': {}, '../models/Payment': {}, '../models/Admission': {},
    '../models/Homework': { countDocuments: async () => 0 },
    '../models/LibraryTransaction': {}, '../models/LibraryBook': {},
    '../models/Attendance': { exists: async () => false },
    '../models/Class': {}, '../models/Parent': {},
    '../models/SubjectAllocation': { find: () => chain([{
      class: '5', academicYear: '2026-2027',
      subject: { _id: subjectId, name: 'Science', code: 'SCI' },
    }]) },
    '../models/Timetable': { find: () => chain([]) },
    '../models/Exam': { countDocuments: async () => 0 },
    '../utils/academic-year': require('../utils/academic-year'),
    '../utils/exam-visibility': require('../utils/exam-visibility'),
    '../utils/attendance-date': require('../utils/attendance-date'),
  };
  const sandbox = {
    exports: {}, module: { exports: {} },
    require: id => modelMap[id] || (() => { throw new Error(`Unexpected import ${id}`); })(),
    Promise, Date, String, Number, Math, Set, Map, Object, Array,
  };
  vm.runInNewContext(dashboardSource, sandbox, { filename: 'dashboard.service.js' });
  const result = await sandbox.exports.getTeacherDashboard(new mongoose.Types.ObjectId());
  assert.deepEqual(jsonValue(result.attendanceScopes), [{
    class: '5', academicYear: '2026-2027', isClassTeacher: false,
    subjects: [{ id: String(subjectId), label: 'Science' }],
  }]);
});

test('parent dashboard returns safely linked legacy children in the frontend identifier shape', async () => {
  const childId = new mongoose.Types.ObjectId();
  const dashboardSource = fs.readFileSync(path.join(root, 'services/dashboard.service.js'), 'utf8');
  const modelMap = {
    '../models/Student': {
      find: () => chain([{
        _id: childId, class: '4', academicYear: '2026-2027', user: { name: 'Synthetic Child' },
      }]),
    },
    '../models/Faculty': {}, '../models/User': {}, '../models/Payment': {}, '../models/Admission': {},
    '../models/Homework': { countDocuments: async () => 0 },
    '../models/LibraryTransaction': {}, '../models/LibraryBook': {}, '../models/Attendance': {},
    '../models/Class': {},
    '../models/Parent': { findOne: () => chain(null) },
    '../models/SubjectAllocation': {}, '../models/Timetable': {},
    '../models/Exam': { findOne: () => chain(null) },
    '../utils/academic-year': require('../utils/academic-year'),
    '../utils/exam-visibility': require('../utils/exam-visibility'),
    '../utils/attendance-date': require('../utils/attendance-date'),
  };
  const sandbox = {
    exports: {}, module: { exports: {} },
    require: id => modelMap[id] || (() => { throw new Error(`Unexpected import ${id}`); })(),
    Promise, Date, String, Number, Math, Set, Map, Object, Array,
  };
  vm.runInNewContext(dashboardSource, sandbox, { filename: 'dashboard.service.js' });
  const children = (await sandbox.exports.getParentDashboard(new mongoose.Types.ObjectId())).children;
  assert.equal(children.length, 1);
  assert.equal(children[0]._id, String(childId));
  assert.equal(children[0].name, 'Synthetic Child');
});
