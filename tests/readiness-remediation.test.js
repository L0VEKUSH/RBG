'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Attendance = require('../models/Attendance');
const Admission = require('../models/Admission');
const Exam = require('../models/Exam');
const Faculty = require('../models/Faculty');
const Homework = require('../models/Homework');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const Timetable = require('../models/Timetable');
const dashboardService = require('../services/dashboard.service');
const reportService = require('../services/report.service');
const timetableService = require('../services/timetable.service');
const reportController = require('../controllers/report.controller');
const { todaySchoolDate, schoolDayBounds } = require('../utils/attendance-date');
const { STUDENT_VISIBLE_EXAM_STATUSES } = require('../utils/exam-visibility');

function stub(target, key, replacement) {
  const original = target[key];
  target[key] = replacement;
  return () => { target[key] = original; };
}

function query(value) {
  const chain = {
    select() { return chain; },
    populate() { return chain; },
    sort() { return chain; },
    lean() { return chain; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
  return chain;
}

function withFixedTime(iso, callback) {
  const OriginalDate = global.Date;
  const timestamp = OriginalDate.parse(iso);
  class FixedDate extends OriginalDate {
    constructor(...args) {
      super(...(args.length ? args : [timestamp]));
    }

    static now() { return timestamp; }
  }
  global.Date = FixedDate;
  return Promise.resolve()
    .then(callback)
    .finally(() => { global.Date = OriginalDate; });
}

test('marks reports reject teachers even when filters are omitted or manipulated', async () => {
  let aggregateCalls = 0;
  const aggregateRestore = stub(require('../models/Marks'), 'aggregate', async () => {
    aggregateCalls += 1;
    return [];
  });
  try {
    await assert.rejects(reportService.getMarksReport({}, { role: 'teacher' }), error => error.statusCode === 403);
    await assert.rejects(reportService.getMarksReport({ class: '12', academicYear: '2026-2027', student: { $ne: null } }, {
      role: 'teacher',
      permissions: ['*', 'reports.view'],
    }), error => error.statusCode === 403);
    assert.equal(aggregateCalls, 0, 'denied teacher requests must not aggregate marks');
    await reportService.getMarksReport({}, { role: 'principal' });
    assert.equal(aggregateCalls, 1, 'authorized management reporting remains available');
  } finally {
    aggregateRestore();
  }
});

test('marks report controller passes authenticated actor to the guarded service', async () => {
  const actor = { _id: 'principal-user', role: 'principal' };
  let received;
  const restore = stub(reportService, 'getMarksReport', async (filters, user) => {
    received = { filters, user };
    return [];
  });
  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  try {
    await reportController.getMarksReport({ query: { class: '6' }, user: actor }, response, error => { throw error; });
    assert.deepEqual(received, { filters: { class: '6' }, user: actor });
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
  } finally {
    restore();
  }
});

test('student report aggregation groups by the Student schema class field', async () => {
  assert.ok(Student.schema.path('class'));
  assert.equal(Student.schema.path('classLevel'), undefined);
  let pipeline;
  const restore = stub(Student, 'aggregate', async value => {
    pipeline = value;
    return [{ _id: '6', studentCount: 2 }];
  });
  try {
    const result = await reportService.getStudentsReport({ isActive: true });
    assert.deepEqual(pipeline[0], { $match: { isActive: true } });
    assert.deepEqual(pipeline[1], { $group: { _id: '$class', studentCount: { $sum: 1 } } });
    assert.deepEqual(result, [{ _id: '6', studentCount: 2 }]);
  } finally {
    restore();
  }
});

test('school date boundaries and dashboard schedule filters use Asia/Kolkata', async () => {
  assert.equal(todaySchoolDate(new Date('2026-11-07T18:29:59.999Z')), '2026-11-07');
  assert.equal(todaySchoolDate(new Date('2026-11-07T18:30:00.000Z')), '2026-11-08');
  assert.equal(schoolDayBounds('2026-11-08').start.toISOString(), '2026-11-07T18:30:00.000Z');

  const filters = { attendance: null, exams: null };
  const originals = [
    [Student, 'countDocuments', stub(Student, 'countDocuments', async () => 0)],
    [Faculty, 'countDocuments', stub(Faculty, 'countDocuments', async () => 0)],
    [Admission, 'countDocuments', stub(Admission, 'countDocuments', async () => 0)],
    [Attendance, 'countDocuments', stub(Attendance, 'countDocuments', async filter => { filters.attendance = filter; return 0; })],
    [Exam, 'countDocuments', stub(Exam, 'countDocuments', async filter => { filters.exams = filter; return 0; })],
  ];
  try {
    await withFixedTime('2026-11-07T20:00:00.000Z', () => dashboardService.getPrincipalDashboard());
    const start = new Date('2026-11-07T18:30:00.000Z');
    const end = new Date('2026-11-08T18:30:00.000Z');
    assert.equal(filters.attendance.date.$gte.toISOString(), start.toISOString());
    assert.equal(filters.attendance.date.$lt.toISOString(), end.toISOString());
    assert.equal(filters.exams.startDate.$gte.toISOString(), start.toISOString());
    assert.deepEqual(filters.exams.isActive, { $ne: false });
    assert.deepEqual(filters.exams.status, { $in: [...STUDENT_VISIBLE_EXAM_STATUSES] });
  } finally {
    originals.reverse().forEach(([, , restore]) => restore());
  }
});

test('student dashboard chooses the school-local weekday and day boundary without changing year/publication scope', async () => {
  const student = {
    _id: 'synthetic-student',
    class: '6',
    academicYear: '2026-2027',
    user: { name: 'Synthetic Student' },
  };
  let examFilter;
  let timetableFilter;
  const originals = [
    [Student, 'findOne', stub(Student, 'findOne', () => query(student))],
    [Exam, 'findOne', stub(Exam, 'findOne', filter => { examFilter = filter; return query(null); })],
    [Timetable, 'findOne', stub(Timetable, 'findOne', filter => { timetableFilter = filter; return query(null); })],
    [Homework, 'countDocuments', stub(Homework, 'countDocuments', async () => 0)],
    [Attendance, 'getStudentSummary', stub(Attendance, 'getStudentSummary', async () => ({ total: 0, percentage: 0 }))],
  ];
  try {
    await withFixedTime('2026-11-07T20:00:00.000Z', () => dashboardService.getStudentDashboard('synthetic-user'));
    const start = new Date('2026-11-07T18:30:00.000Z');
    assert.equal(examFilter.startDate.$gte.toISOString(), start.toISOString());
    assert.deepEqual(examFilter.status, { $in: [...STUDENT_VISIBLE_EXAM_STATUSES] });
    assert.equal(examFilter.academicYear, '2026-2027');
    assert.equal(timetableFilter.day, 'Sunday');
    assert.equal(timetableFilter.academicYear, '2026-2027');
  } finally {
    originals.reverse().forEach(([, , restore]) => restore());
  }
});

test('Parent timetable grouping converts schedule documents into ordered weekday periods', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/parent-portal.js'), 'utf8');
  const helper = source.match(/function groupParentSchedulesByDay\(schedules\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'the Parent portal grouping function must exist');
  assert.match(source, /groupParentSchedulesByDay\(data\.data\)/);
  assert.match(source, /timetable\/class\/\$\{className\}\?academicYear=\$\{academicYear\}/);
  const group = vm.runInNewContext(`(${helper})`, {
    PARENT_TIMETABLE_DAYS: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  });
  const grouped = JSON.parse(JSON.stringify(group([
    { day: 'Monday', periods: [{ periodNumber: 3, subject: 'Science' }, { periodNumber: 1, subject: 'Math', teacher: { user: { name: 'Teacher A' } } }] },
    { day: 'Sunday', periods: [{ periodNumber: 1, subject: 'Ignored' }] },
    { day: 'Tuesday', periods: [] },
  ])));
  assert.deepEqual(grouped.Monday.map(period => [period.periodNumber, period.subject, period.teacher]), [
    [1, 'Math', 'Teacher A'],
    [3, 'Science', ''],
  ]);
  assert.deepEqual(grouped.Tuesday, []);
});

test('Parent timetable query requires and enforces the selected linked child academic year', async () => {
  let studentFilter;
  let timetableFilter;
  const originals = [
    [Parent, 'findOne', stub(Parent, 'findOne', () => query({ children: ['linked-child'] }))],
    [Student, 'find', stub(Student, 'find', filter => {
      studentFilter = filter;
      return query([{ academicYear: '2026-2027' }]);
    })],
    [Timetable, 'find', stub(Timetable, 'find', filter => {
      timetableFilter = filter;
      return query([]);
    })],
  ];
  try {
    await timetableService.getTimetableByClass('6', '2026-2027', { _id: 'parent-user', role: 'parent' });
    assert.equal(studentFilter.class, '6');
    assert.equal(studentFilter.academicYear, '2026-2027');
    assert.deepEqual(studentFilter.$or, [
      { _id: { $in: ['linked-child'] } },
      { parentUser: 'parent-user' },
    ]);
    assert.deepEqual(timetableFilter, {
      class: '6',
      academicYear: { $in: ['2026-2027'] },
      isActive: { $ne: false },
    });
  } finally {
    originals.reverse().forEach(([, , restore]) => restore());
  }
});

test('Parent timetable fails closed when the selected child year is missing', async () => {
  let studentReads = 0;
  const restores = [
    stub(Parent, 'findOne', () => query({ children: ['linked-child'] })),
    stub(Student, 'find', () => { studentReads += 1; return query([]); }),
  ];
  try {
    await assert.rejects(
      timetableService.getTimetableByClass('6', undefined, { _id: 'parent-user', role: 'parent' }),
      error => error.statusCode === 404,
    );
    assert.equal(studentReads, 0);
  } finally {
    restores.reverse().forEach(restore => restore());
  }
});

test('Parent attendance calendar uses Asia/Kolkata dates instead of browser-local dates', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/parent-portal.js'), 'utf8');
  const start = source.indexOf("const PARENT_SCHOOL_TIME_ZONE = 'Asia/Kolkata';");
  const end = source.indexOf('async function loadHomework()', start);
  assert.notEqual(start, -1, 'Parent attendance helpers must declare the school timezone');
  assert.notEqual(end, -1, 'Parent attendance calendar implementation must be present');

  // Simulate a browser in UTC-8: local getters would report Feb 28 for the first record.
  class BrowserLocalDate extends Date {
    _browserLocalDate() { return new Date(this.getTime() - 8 * 60 * 60 * 1000); }
    getDate() { return this._browserLocalDate().getUTCDate(); }
    getDay() { return this._browserLocalDate().getUTCDay(); }
    getMonth() { return this._browserLocalDate().getUTCMonth(); }
    getFullYear() { return this._browserLocalDate().getUTCFullYear(); }
  }
  const calendar = vm.runInNewContext(
    `${source.slice(start, end)}\n({ parentAttendanceCalendarModel, renderParentAttCalendar, parentSchoolDateParts })`,
    { Date: BrowserLocalDate, Intl },
  );

  const result = calendar.parentAttendanceCalendarModel(2026, 3, [
    { date: '2026-03-01T00:30:00.000Z', status: 'Present' },
    { date: '2026-03-01T18:29:59.999Z', status: 'Late' },
    { date: '2026-03-01T18:30:00.000Z', status: 'Absent' },
    { date: '2026-04-01T00:00:00.000Z', status: 'Present' },
  ]);

  const schoolMonth = calendar.parentSchoolDateParts('2026-03-01T00:30:00.000Z');
  assert.deepEqual(JSON.parse(JSON.stringify(schoolMonth)), { year: 2026, month: 3, day: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(result.dayMap)), { 1: 'late', 2: 'absent' });
  assert.equal(result.daysInMonth, 31);

  const element = { innerHTML: '' };
  calendar.renderParentAttCalendar(element, 2026, 3, [
    { date: '2026-03-01T00:30:00.000Z', status: 'Present' },
  ]);
  assert.match(element.innerHTML, /attendance-calendar-day--present" title="present">1<\/div>/);
});

test('Parent attendance month arithmetic handles year boundaries and leap February', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/parent-portal.js'), 'utf8');
  const start = source.indexOf("const PARENT_SCHOOL_TIME_ZONE = 'Asia/Kolkata';");
  const end = source.indexOf('async function loadHomework()', start);
  const calendar = vm.runInNewContext(
    `${source.slice(start, end)}\n({ shiftParentAttendanceMonth, parentAttendanceCalendarModel })`,
    { Date, Intl },
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(calendar.shiftParentAttendanceMonth(2026, 1, -1))),
    { year: 2025, month: 12 },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(calendar.shiftParentAttendanceMonth(2025, 12, 1))),
    { year: 2026, month: 1 },
  );

  const leapFebruary = calendar.parentAttendanceCalendarModel(2024, 2, []);
  assert.equal(leapFebruary.daysInMonth, 29);
  assert.equal(leapFebruary.leadingBlankDays, 3, '2024-02-01 is Thursday in the Monday-first calendar');
  assert.equal(calendar.parentAttendanceCalendarModel(2023, 2, []).daysInMonth, 28);
});
