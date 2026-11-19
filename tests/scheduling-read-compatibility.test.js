'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Attendance = require('../models/Attendance');
const Class = require('../models/Class');
const Exam = require('../models/Exam');
const Faculty = require('../models/Faculty');
const Homework = require('../models/Homework');
const Student = require('../models/Student');
const SubjectAllocation = require('../models/SubjectAllocation');
const Timetable = require('../models/Timetable');
const dashboardService = require('../services/dashboard.service');
const examService = require('../services/exam.service');
const marksService = require('../services/marks.service');
const timetableService = require('../services/timetable.service');
const { STUDENT_VISIBLE_EXAM_STATUSES } = require('../utils/exam-visibility');

function stub(target, key, replacement) {
  const original = target[key];
  target[key] = replacement;
  return () => { target[key] = original; };
}

function query(value) {
  return {
    select() { return this; },
    populate() { return this; },
    sort() { return this; },
    lean() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function withStubs(entries, callback) {
  const restores = entries.map(([target, key, replacement]) => stub(target, key, replacement));
  return Promise.resolve()
    .then(callback)
    .finally(() => restores.reverse().forEach(restore => restore()));
}

const studentUserId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const teacherUserId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const facultyId = 'cccccccccccccccccccccccc';
const studentId = 'dddddddddddddddddddddddd';
const examId = 'eeeeeeeeeeeeeeeeeeeeeeee';
const year = '2025-2026';

test('Student dashboard scopes exam and timetable to the valid enrolled year and visible exam states', async () => {
  const calls = {};
  const student = {
    _id: studentId,
    class: '6',
    academicYear: year,
    user: { name: 'Synthetic Student' },
    admissionNumber: 'S-TEST',
  };
  await withStubs([
    [Student, 'findOne', () => query(student)],
    [Exam, 'findOne', filter => { calls.exam = filter; return query(null); }],
    [Timetable, 'findOne', filter => { calls.timetable = filter; return query(null); }],
    [Homework, 'countDocuments', async () => 0],
    [Attendance, 'getStudentSummary', async () => ({ total: 0, percentage: 0 })],
  ], async () => {
    const result = await dashboardService.getStudentDashboard(studentUserId);
    assert.equal(result.nextExam, null);
  });

  assert.equal(calls.exam.class, '6');
  assert.equal(calls.exam.academicYear, year);
  assert.deepEqual(calls.exam.status, { $in: [...STUDENT_VISIBLE_EXAM_STATUSES] });
  assert.deepEqual(calls.exam.isActive, { $ne: false });
  assert.equal(calls.timetable.class, '6');
  assert.equal(calls.timetable.academicYear, year);
  assert.equal(calls.timetable.isActive, true);
});

test('Student dashboard skips schedule reads when the Student year is missing or malformed', async () => {
  for (const academicYear of [undefined, '2025-26']) {
    const calls = { exam: 0, timetable: 0 };
    await withStubs([
      [Student, 'findOne', () => query({
        _id: studentId,
        class: '6',
        academicYear,
        user: { name: 'Synthetic Student' },
      })],
      [Exam, 'findOne', () => { calls.exam += 1; return query(null); }],
      [Timetable, 'findOne', () => { calls.timetable += 1; return query(null); }],
      [Homework, 'countDocuments', async () => 0],
      [Attendance, 'getStudentSummary', async () => ({ total: 0, percentage: 0 })],
    ], async () => {
      const result = await dashboardService.getStudentDashboard(studentUserId);
      assert.equal(result.nextExam, null);
      assert.deepEqual(result.todaysSchedule, []);
    });
    assert.deepEqual(calls, { exam: 0, timetable: 0 });
  }
});

test('Teacher list and upcoming exam queries enforce assignment scope and published active status', async () => {
  const calls = [];
  const exam = {
    _id: examId,
    class: '6',
    academicYear: year,
    status: 'Scheduled',
    isActive: true,
    subjects: [{ subject: 'Mathematics' }],
  };
  const assignments = [{
    class: '6',
    academicYear: year,
    subject: { _id: 'ffffffffffffffffffffffff', name: 'Mathematics' },
  }];
  const modelStubs = [
    [Faculty, 'findOne', () => query({ _id: facultyId, classTeacherOf: null })],
    [SubjectAllocation, 'find', () => query(assignments)],
    [Exam, 'find', filter => { calls.push(filter); return query([exam]); }],
  ];
  await withStubs(modelStubs, async () => {
    const teacher = { _id: teacherUserId, role: 'teacher', permissions: ['exams.view'] };
    await examService.getAllExams(teacher);
    await examService.getExamsByClass('6', year, teacher);
    await examService.getUpcomingExams(teacher, { class: '6', academicYear: year });
  });

  assert.equal(calls.length, 3);
  for (const filter of calls) {
    const assignedScope = filter.$and.find(item => item.class === '6' && item.academicYear === year);
    assert.deepEqual(assignedScope, { class: '6', academicYear: year });
    const published = filter.$and.find(item => item.status);
    assert.deepEqual(published.status, { $in: [...STUDENT_VISIBLE_EXAM_STATUSES] });
    assert.deepEqual(published.isActive, { $ne: false });
  }
});

test('Teacher detail hides Draft/inactive exams while Super Admin retains management detail access', async () => {
  for (const unpublished of [
    { _id: examId, class: '6', academicYear: year, status: 'Draft', isActive: true },
    { _id: examId, class: '6', academicYear: year, status: 'Scheduled', isActive: false },
  ]) {
    const restore = stub(Exam, 'findById', async () => unpublished);
    try {
      assert.equal(await examService.getExamById(examId, {
        _id: teacherUserId,
        role: 'teacher',
      }), null);
    } finally {
      restore();
    }
  }

  const activeDraft = { _id: examId, class: '6', academicYear: year, status: 'Draft', isActive: true };
  const restore = stub(Exam, 'findById', async () => activeDraft);
  try {
    assert.equal(await examService.getExamById(examId, { _id: 'root', role: 'super_admin' }), activeDraft);
  } finally {
    restore();
  }

  const assignedOnly = stub(Exam, 'findById', async () => ({
    _id: examId, class: '7', academicYear: year, status: 'Scheduled', isActive: true,
  }));
  const restoreFaculty = stub(Faculty, 'findOne', () => query({ _id: facultyId, classTeacherOf: null }));
  const restoreAssignments = stub(SubjectAllocation, 'find', () => query([{
    class: '6', academicYear: year, subject: { _id: 'ffffffffffffffffffffffff', name: 'Mathematics' },
  }]));
  try {
    assert.equal(await examService.getExamById(examId, { _id: teacherUserId, role: 'teacher' }), null);
  } finally {
    restoreAssignments();
    restoreFaculty();
    assignedOnly();
  }
});

test('Invalid Student and Teacher assignment years fail closed before exam queries', async () => {
  for (const actor of [
    { _id: studentUserId, role: 'student' },
    { _id: teacherUserId, role: 'teacher' },
  ]) {
    let examReads = 0;
    const entries = [
      [Student, 'findOne', () => query({ class: '6', academicYear: 'invalid' })],
      [Faculty, 'findOne', () => query({ _id: facultyId, classTeacherOf: { class: '6', academicYear: '2025-26' } })],
      [SubjectAllocation, 'find', () => query([{ class: '6', academicYear: '2025-26', subject: 'Math' }])],
      [Exam, 'find', () => { examReads += 1; return query([]); }],
    ];
    await withStubs(entries, async () => {
      assert.deepEqual(await examService.getAllExams(actor), []);
    });
    assert.equal(examReads, 0);
  }
});

test('Timetable Student and teacher reads reject or omit schedules without valid authoritative years', async () => {
  let timetableReads = 0;
  await withStubs([
    [Student, 'findOne', () => query({ class: '6', academicYear: 'bad-year' })],
    [Faculty, 'findOne', () => query({ _id: facultyId, classTeacherOf: { class: '6', academicYear: 'bad-year' } })],
    [SubjectAllocation, 'find', () => query([{ class: '6', academicYear: null }])],
    [Timetable, 'find', () => { timetableReads += 1; return query([]); }],
  ], async () => {
    assert.deepEqual(await timetableService.getMyTimetable(studentUserId, 'student'), []);
    await assert.rejects(
      timetableService.getTimetableByClass('6', undefined, { _id: studentUserId, role: 'student' }),
      error => error.statusCode === 404,
    );
    assert.deepEqual(await timetableService.getMyTimetable(teacherUserId, 'teacher'), []);
    await assert.rejects(
      timetableService.getTimetableByClass('6', undefined, { _id: teacherUserId, role: 'teacher' }),
      error => error.statusCode === 404,
    );
  });
  assert.equal(timetableReads, 0);
});

test('Exam create and update reject duplicate exact exam types within class and year', async () => {
  const calls = [];
  const existing = { _id: examId, class: '6', academicYear: year, examType: 'Unit Test 1' };
  await withStubs([
    [Class, 'findOne', async () => ({ _id: 'class-record' })],
    [Exam, 'exists', async filter => { calls.push(filter); return true; }],
    [Exam, 'create', async () => { throw new Error('must not create duplicate'); }],
    [Exam, 'findById', async () => existing],
    [Exam, 'findByIdAndUpdate', async () => { throw new Error('must not update duplicate'); }],
  ], async () => {
    const schedule = {
      name: 'Synthetic exam',
      examType: 'Unit Test 1',
      class: '6',
      academicYear: year,
      subjects: [{ subject: 'Mathematics' }],
    };
    await assert.rejects(examService.createExam(schedule, teacherUserId), error => error.statusCode === 409);
    await assert.rejects(examService.updateExam(examId, { name: 'Renamed' }), error => error.statusCode === 409);
  });
  assert.deepEqual(calls[0], { class: '6', academicYear: year, examType: 'Unit Test 1' });
  assert.deepEqual(calls[1], {
    class: '6', academicYear: year, examType: 'Unit Test 1', _id: { $ne: examId },
  });
});

test('Teacher marks lookup cannot match Draft or inactive exam schedules', async () => {
  let examFilter;
  const draftExam = {
    _id: examId,
    class: '6',
    academicYear: year,
    examType: 'Unit Test 1',
    status: 'Draft',
    isActive: true,
  };
  await withStubs([
    [Student, 'findOne', () => query({ _id: studentId, class: '6', academicYear: year })],
    [Exam, 'find', filter => {
      examFilter = filter;
      const statusMatches = filter.status.$in.includes(draftExam.status);
      const activeMatches = draftExam.isActive !== false;
      return query(statusMatches && activeMatches ? [draftExam] : []);
    }],
  ], async () => {
    await assert.rejects(marksService.addOrUpdateMarks({
      student: studentId,
      class: '6',
      academicYear: year,
      examType: 'Unit Test 1',
      subjects: [{ subject: 'Mathematics', marksObtained: 80 }],
    }, { _id: teacherUserId, role: 'teacher' }), error => error.statusCode === 404);
  });
  assert.deepEqual(examFilter.status, { $in: [...STUDENT_VISIBLE_EXAM_STATUSES] });
  assert.deepEqual(examFilter.isActive, { $ne: false });
});

test('Exam type uniqueness has a compound database constraint and race conflicts map to HTTP 409', async () => {
  const index = Exam.schema.indexes().find(([keys, options]) =>
    JSON.stringify(keys) === JSON.stringify({ class: 1, academicYear: 1, examType: 1 })
      && options.unique === true);
  assert.ok(index, 'class/year/examType must be unique at the database boundary');

  const existing = { _id: examId, class: '6', academicYear: year, examType: 'Unit Test 1' };
  await withStubs([
    [Class, 'findOne', async () => ({ _id: 'class-record' })],
    [Exam, 'exists', async () => false],
    [Exam, 'create', async () => { throw Object.assign(new Error('duplicate key'), { code: 11000 }); }],
    [Exam, 'findById', async () => existing],
    [Exam, 'findByIdAndUpdate', async () => { throw Object.assign(new Error('duplicate key'), { code: 11000 }); }],
  ], async () => {
    await assert.rejects(examService.createExam({
      name: 'Synthetic exam',
      examType: 'Unit Test 1',
      class: '6',
      academicYear: year,
      subjects: [{ subject: 'Mathematics' }],
    }, teacherUserId), error => error.statusCode === 409);
    await assert.rejects(examService.updateExam(examId, { name: 'Renamed' }), error => error.statusCode === 409);
  });
});
