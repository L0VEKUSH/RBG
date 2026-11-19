'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHomeworkService } = require('../services/homework.service');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const { requireHomeworkClassAccess } = require('../middleware/authorization.middleware');

function valueMatches(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (Object.prototype.hasOwnProperty.call(expected, '$ne')) return String(actual) !== String(expected.$ne);
    if (Object.prototype.hasOwnProperty.call(expected, '$in')) return expected.$in.some(value => String(value) === String(actual));
  }
  return String(actual) === String(expected);
}

function matches(document, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some(branch => matches(document, branch));
    if (key === 'submissions' && expected?.$elemMatch) {
      return (document.submissions || []).some(submission => matches(submission, expected.$elemMatch));
    }
    if (key === 'submissions' && expected?.$not?.$elemMatch) {
      return !(document.submissions || []).some(submission => matches(submission, expected.$not.$elemMatch));
    }
    return valueMatches(document[key], expected);
  });
}

function fixture({ students = [], parent = null, homework = [], faculty = [], allocations = [] } = {}) {
  const calls = { studentFind: [], homeworkFind: [], homeworkFindOne: [], facultyFind: [], allocationFind: [], updates: [], deletes: [], creates: [] };
  const models = {
    Homework: {
      find: async filter => {
        calls.homeworkFind.push(filter);
        return homework.filter(row => matches(row, filter));
      },
      findOne: async filter => {
        calls.homeworkFindOne.push(filter);
        return homework.find(row => matches(row, filter)) || null;
      },
      findOneAndUpdate: async (filter, update) => {
        calls.updates.push({ filter, update });
        const row = homework.find(item => matches(item, filter));
        if (!row) return null;
        if (update.$set) {
          for (const [field, value] of Object.entries(update.$set)) {
            const positionalMatch = field.match(/^submissions\.\$\.(.+)$/);
            if (positionalMatch) {
              const index = row.submissions.findIndex(submission => matches(submission, filter.submissions.$elemMatch));
              if (index >= 0) row.submissions[index][positionalMatch[1]] = value;
            } else row[field] = value;
          }
        }
        if (update.$push?.submissions) row.submissions.push(update.$push.submissions);
        return row;
      },
      findOneAndDelete: async filter => {
        calls.deletes.push(filter);
        const index = homework.findIndex(row => matches(row, filter));
        return index < 0 ? null : homework.splice(index, 1)[0];
      },
      create: async row => { calls.creates.push(row); return row; },
    },
    Student: {
      findOne: async filter => students.find(row => matches(row, filter)) || null,
      find: async filter => {
        calls.studentFind.push(filter);
        return students.filter(row => matches(row, filter));
      },
    },
    Parent: {
      findOne: async filter => parent && matches(parent, filter) ? parent : null,
    },
    Faculty: {
      findOne: async filter => {
        calls.facultyFind.push(filter);
        return faculty.find(row => matches(row, filter)) || null;
      },
    },
    SubjectAllocation: {
      find: async filter => {
        calls.allocationFind.push(filter);
        return allocations.filter(row => matches(row, filter));
      },
    },
  };
  return { service: createHomeworkService(models), calls, students, homework };
}

function homeworkRow(overrides = {}) {
  return {
    _id: 'homework-7-2026',
    title: 'Fractions',
    description: 'Practice set',
    class: '7',
    subject: 'Mathematics',
    dueDate: new Date('2026-12-10T00:00:00Z'),
    academicYear: '2026-2027',
    isActive: true,
    teacher: 'teacher-A',
    attachments: [],
    submissions: [
      { _id: 'submission-A', student: 'student-A', content: 'private A', grade: 'A', feedback: 'feedback A', status: 'Reviewed' },
      { _id: 'submission-B', student: 'student-B', content: 'private B', grade: 'F', feedback: 'feedback B', status: 'Reviewed' },
    ],
    ...overrides,
  };
}

const studentA = { _id: 'student-A', user: 'user-A', class: '7', academicYear: '2026-2027', isActive: true };
const studentB = { _id: 'student-B', user: 'user-B', class: '7', academicYear: '2026-2027', isActive: true };
const teacherA = { _id: 'teacher-A', role: 'teacher' };
const teacherB = { _id: 'teacher-B', role: 'teacher' };
const teacherAFaculty = {
  _id: 'faculty-A', user: 'teacher-A', isActive: true,
  classTeacherOf: { class: '', academicYear: '' },
};
const teacherAMathAllocation = {
  teacher: 'faculty-A', class: '7', academicYear: '2026-2027',
  subject: { _id: 'subject-math', name: 'Mathematics' },
};

test('student detail and DTO expose only the requesting student submission', async () => {
  const row = homeworkRow();
  const { service, calls } = fixture({ students: [studentA, studentB], homework: [row] });

  const result = await service.getHomeworkById(row._id, { _id: 'user-A', role: 'student' });

  assert.equal(result.status, 'reviewed');
  assert.equal(result.submission.content, 'private A');
  assert.equal(result.submission.feedback, 'feedback A');
  assert.equal(Object.hasOwn(result, 'submissions'), false);
  assert.doesNotMatch(JSON.stringify(result), /student-B|private B|feedback B|submission-B/);
  assert.deepEqual(calls.homeworkFindOne[0], {
    class: '7', academicYear: '2026-2027', isActive: { $ne: false }, _id: row._id,
  });
});

test('student homework method requires authenticated context and returns only the caller student data', async () => {
  const assigned = homeworkRow({ _id: 'assigned-to-class-7' });
  const anotherClass = homeworkRow({ _id: 'class-8-homework', class: '8', academicYear: '2026-2027' });
  const { service, calls } = fixture({
    students: [studentA, studentB],
    homework: [assigned, anotherClass],
  });

  await assert.rejects(
    service.getStudentHomework('user-B'),
    error => error.statusCode === 403 && error.message === 'Authenticated user context is required'
  );
  assert.equal(calls.homeworkFind.length, 0, 'a bare user ID must be rejected before any homework query');

  const ownRows = await service.getStudentHomework({ _id: 'user-A', role: 'student' });
  assert.equal(ownRows.length, 1);
  assert.equal(ownRows[0]._id, assigned._id);
  assert.equal(ownRows[0].submission.content, 'private A');
  assert.doesNotMatch(JSON.stringify(ownRows), /private B|feedback B|submission-B/);

  const otherClassDetail = await service.getHomeworkById(anotherClass._id, { _id: 'user-A', role: 'student' });
  assert.equal(otherClassDetail, null, 'the authenticated student cannot retrieve homework outside their class/year');
});

test('student list/detail queries are scoped to the current class and academic year', async () => {
  const wrongClass = homeworkRow({ _id: 'wrong-class', class: '8' });
  const wrongYear = homeworkRow({ _id: 'wrong-year', academicYear: '2025-2026' });
  const correct = homeworkRow();
  const outOfScopeStudent = { ...studentA, class: '8', academicYear: '2027-2028' };
  const { service, calls } = fixture({ students: [outOfScopeStudent], homework: [wrongClass, wrongYear, correct] });

  const list = await service.getHomework({}, { _id: 'user-A', role: 'student' });
  const detail = await service.getHomeworkById(correct._id, { _id: 'user-A', role: 'student' });

  assert.deepEqual(list, []);
  assert.equal(detail, null);
  assert.deepEqual(calls.homeworkFind[0], {
    class: '8', academicYear: '2027-2028', isActive: { $ne: false },
  });
  assert.deepEqual(calls.homeworkFindOne[0], {
    class: '8', academicYear: '2027-2028', isActive: { $ne: false }, _id: correct._id,
  });
});

test('parent receives only linked child submissions, even when a classmate shares the class/year', async () => {
  const row = homeworkRow();
  const { service } = fixture({
    parent: { user: 'parent-A', children: ['student-A'] },
    students: [studentA, studentB],
    homework: [row],
  });

  const result = await service.getHomework({ studentId: 'student-A' }, { _id: 'parent-A', role: 'parent' });

  assert.equal(result.length, 1);
  assert.equal(result[0].studentId, 'student-A');
  assert.equal(result[0].submission.content, 'private A');
  assert.doesNotMatch(JSON.stringify(result), /student-B|private B|feedback B|submission-B/);
  await assert.rejects(
    service.getHomework({ studentId: 'student-B' }, { _id: 'parent-A', role: 'parent' }),
    error => error.statusCode === 404 && error.message === 'Linked student not found'
  );
});

test('parent legacy Student.parentUser links remain usable without a Parent.children document', async () => {
  const legacyChild = { ...studentA, parentUser: 'parent-legacy' };
  const row = homeworkRow({ submissions: [
    { _id: 'legacy-submission', student: 'student-A', content: 'legacy child work', status: 'Submitted' },
  ] });
  const { service, calls } = fixture({ students: [legacyChild], homework: [row] });

  const result = await service.getHomework({ studentId: 'student-A' }, { _id: 'parent-legacy', role: 'parent' });

  assert.equal(result.length, 1);
  assert.equal(result[0].submission.content, 'legacy child work');
  assert.equal(calls.studentFind[0].$or[1].parentUser, 'parent-legacy');
});

test('parent without any verified child link is denied and does not query homework', async () => {
  const { service, calls } = fixture({ students: [studentA], homework: [homeworkRow()] });
  await assert.rejects(
    service.getHomework({}, { _id: 'parent-unlinked', role: 'parent' }),
    error => error.statusCode === 404
  );
  assert.equal(calls.homeworkFind.length, 0);
});

test('parent cannot request a child linked only to a different parent', async () => {
  const otherParentsChild = { ...studentB, parentUser: 'parent-B' };
  const { service, calls } = fixture({
    parent: { user: 'parent-A', children: [] },
    students: [otherParentsChild],
    homework: [homeworkRow()],
  });
  await assert.rejects(
    service.getHomework({ studentId: 'student-B' }, { _id: 'parent-A', role: 'parent' }),
    error => error.statusCode === 404
  );
  assert.equal(calls.homeworkFind.length, 0);
});

test('custom permission-only roles cannot read unscoped homework or submission details', async () => {
  const { service, calls } = fixture({ homework: [homeworkRow()] });
  const customCaller = { _id: 'custom-user', role: 'custom_role', permissions: ['homework.view-linked'] };
  await assert.rejects(service.getHomework({}, customCaller), error => error.statusCode === 403);
  await assert.rejects(service.getHomeworkById('homework-7-2026', customCaller), error => error.statusCode === 403);
  assert.equal(calls.homeworkFind.length, 0);
  assert.equal(calls.homeworkFindOne.length, 0);
});

test('permission-only non-teacher cannot review submissions or trigger a broad query', async () => {
  const { service, calls } = fixture({ homework: [homeworkRow()] });
  const customReviewer = { _id: 'custom-reviewer', role: 'custom_role', permissions: ['homework.review'] };
  await assert.rejects(
    service.reviewSubmission('homework-7-2026', 'submission-A', {}, customReviewer),
    error => error.statusCode === 403
  );
  assert.equal(calls.homeworkFindOne.length, 0);
});

test('Homework class middleware recognizes Parent.children and legacy Student.parentUser links', async (t) => {
  const originalParentFindOne = Parent.findOne;
  const originalStudentFindOne = Student.findOne;
  const parentFilters = [];
  try {
    for (const linkage of [
      { name: 'Parent.children', parent: { user: 'parent-A', children: ['student-A'] }, child: studentA },
      { name: 'legacy Student.parentUser', parent: null, child: { ...studentA, parentUser: 'parent-A' } },
    ]) {
      await t.test(linkage.name, async () => {
        Parent.findOne = async filter => {
          parentFilters.push(filter);
          return linkage.parent;
        };
        Student.findOne = async filter => {
          assert.equal(filter.class, '7');
          assert.equal(filter.isActive.$ne, false);
          assert.equal(filter.$or[1].parentUser, 'parent-A');
          const hasChildId = filter.$or[0]._id.$in.some(id => String(id) === String(linkage.child._id));
          const hasLegacyLink = linkage.child.parentUser === 'parent-A';
          return hasChildId || hasLegacyLink ? linkage.child : null;
        };
        let forwardedError;
        await requireHomeworkClassAccess('class')({
          user: { _id: 'parent-A', role: 'parent' },
          params: { class: '7' }, body: {}, query: {},
        }, {}, error => { forwardedError = error; });
        assert.equal(forwardedError, undefined);
      });
    }

    Parent.findOne = async () => null;
    Student.findOne = async () => null;
    let forwardedError;
    await requireHomeworkClassAccess('class')({
      user: { _id: 'parent-unlinked', role: 'parent' },
      params: { class: '7' }, body: {}, query: {},
    }, {}, error => { forwardedError = error; });
    assert.equal(forwardedError.statusCode, 404);
    assert.equal(parentFilters.length, 2);
  } finally {
    Parent.findOne = originalParentFindOne;
    Student.findOne = originalStudentFindOne;
  }
});

test('teacher A cannot update or delete teacher B homework and receives the same not-found error', async () => {
  const row = homeworkRow({ teacher: 'teacher-B' });
  const { service, calls } = fixture({
    homework: [row], faculty: [teacherAFaculty], allocations: [teacherAMathAllocation],
  });

  await assert.rejects(service.updateHomework(row._id, teacherA, { title: 'Hijacked' }), error =>
    error.statusCode === 404 && error.message === 'Homework not found');
  await assert.rejects(service.deleteHomework(row._id, teacherA), error =>
    error.statusCode === 404 && error.message === 'Homework not found');

  assert.deepEqual(calls.updates[0].filter, {
    _id: row._id, teacher: 'teacher-A', isActive: { $ne: false },
    $or: [{ class: '7', academicYear: '2026-2027', subject: { $in: ['subject-math', 'Mathematics'] } }],
  });
  assert.deepEqual(calls.deletes[0], calls.updates[0].filter);
  assert.equal(row.title, 'Fractions');
});

test('teacher listing and detail use the schema owner field and assigned class/year/subject scope', async () => {
  const own = homeworkRow({ _id: 'own-homework', teacher: 'teacher-A', createdBy: 'teacher-B' });
  const other = homeworkRow({ _id: 'other-homework', teacher: 'teacher-B', createdBy: 'teacher-A' });
  const outsideYear = homeworkRow({ _id: 'outside-year', teacher: 'teacher-A', academicYear: '2025-2026' });
  const outsideSubject = homeworkRow({ _id: 'outside-subject', teacher: 'teacher-A', subject: 'Science' });
  const outsideClass = homeworkRow({ _id: 'outside-class', teacher: 'teacher-A', class: '8' });
  const { service, calls } = fixture({
    homework: [own, other, outsideYear, outsideSubject, outsideClass],
    faculty: [teacherAFaculty], allocations: [teacherAMathAllocation],
  });

  const listed = await service.getHomework({}, teacherA);
  const otherDetail = await service.getHomeworkById(other._id, teacherA);

  assert.deepEqual(listed.map(row => row._id), ['own-homework']);
  assert.deepEqual(calls.homeworkFind[0], {
    teacher: 'teacher-A', isActive: { $ne: false },
    $or: [{ class: '7', academicYear: '2026-2027', subject: { $in: ['subject-math', 'Mathematics'] } }],
  });
  assert.equal(otherDetail, null);
  assert.deepEqual(calls.homeworkFindOne[0], {
    _id: 'other-homework', teacher: 'teacher-A', isActive: { $ne: false },
    $or: [{ class: '7', academicYear: '2026-2027', subject: { $in: ['subject-math', 'Mathematics'] } }],
  });
});

test('class teacher reads only the assigned class and academic year', async () => {
  const classTeacher = { _id: 'teacher-A', role: 'class_teacher' };
  const faculty = {
    _id: 'faculty-A', user: 'teacher-A', isActive: true,
    classTeacherOf: { class: '7', academicYear: '2026-2027' },
  };
  const inScope = homeworkRow({ _id: 'class-7-current', teacher: 'teacher-A' });
  const otherClass = homeworkRow({ _id: 'class-8-current', teacher: 'teacher-A', class: '8' });
  const otherYear = homeworkRow({ _id: 'class-7-old-year', teacher: 'teacher-A', academicYear: '2025-2026' });
  const { service, calls } = fixture({
    faculty: [faculty],
    homework: [inScope, otherClass, otherYear],
  });

  const result = await service.getHomework({}, classTeacher);
  assert.deepEqual(result.map(row => row._id), ['class-7-current']);
  assert.deepEqual(calls.homeworkFind[0], {
    teacher: 'teacher-A', isActive: { $ne: false },
    $or: [{ class: '7', academicYear: '2026-2027' }],
  });
  assert.equal(await service.getHomeworkById(otherClass._id, classTeacher), null);
  assert.equal(await service.getHomeworkById(otherYear._id, classTeacher), null);
});

test('admin broad reads require an explicit homework permission and do not include submissions without review permission', async () => {
  const rows = [
    homeworkRow({ _id: 'class-7', teacher: 'teacher-A' }),
    homeworkRow({ _id: 'class-8', class: '8', teacher: 'teacher-B' }),
  ];
  const { service, calls } = fixture({ homework: rows });
  const adminWithoutPolicy = { _id: 'admin-no-policy', role: 'school_admin', permissions: [] };
  await assert.rejects(
    service.getHomework({}, adminWithoutPolicy),
    error => error.statusCode === 403
  );
  assert.equal(calls.homeworkFind.length, 0);

  const adminWithView = { _id: 'admin-view', role: 'school_admin', permissions: ['homework.view'] };
  const result = await service.getHomework({}, adminWithView);
  assert.deepEqual(result.map(row => row._id), ['class-7', 'class-8']);
  assert.equal(Object.hasOwn(result[0], 'submissions'), false);
  assert.deepEqual(calls.homeworkFind[0], { isActive: { $ne: false } });
});

test('teacher update ignores ownership, class, year, and embedded-submission fields', async () => {
  const row = homeworkRow();
  const { service, calls } = fixture({
    homework: [row], faculty: [teacherAFaculty], allocations: [teacherAMathAllocation],
  });

  const result = await service.updateHomework(row._id, teacherA, {
    title: 'Updated title',
    description: 'Updated instructions',
    teacher: 'teacher-B',
    createdBy: 'teacher-B',
    class: '12',
    academicYear: '2030-2031',
    subject: 'Other subject',
    submissions: [{ student: 'student-B', grade: 'A+' }],
    isActive: false,
  });

  assert.deepEqual(calls.updates[0].filter, {
    _id: row._id, teacher: 'teacher-A', isActive: { $ne: false },
    $or: [{ class: '7', academicYear: '2026-2027', subject: { $in: ['subject-math', 'Mathematics'] } }],
  });
  assert.deepEqual(calls.updates[0].update, { $set: { title: 'Updated title', description: 'Updated instructions' } });
  assert.equal(row.teacher, 'teacher-A');
  assert.equal(row.class, '7');
  assert.equal(row.academicYear, '2026-2027');
  assert.equal(row.submissions[1].grade, 'F');
  assert.equal(result.title, 'Updated title');
});

test('authorized owner can update and delete their own homework', async () => {
  const row = homeworkRow();
  const { service, calls } = fixture({
    homework: [row], faculty: [teacherAFaculty], allocations: [teacherAMathAllocation],
  });

  const updated = await service.updateHomework(row._id, teacherA, { title: 'Owner update' });
  const deleted = await service.deleteHomework(row._id, teacherA);

  assert.equal(updated.title, 'Owner update');
  assert.equal(deleted, true);
  const expectedOwnerScope = {
    _id: row._id, teacher: 'teacher-A', isActive: { $ne: false },
    $or: [{ class: '7', academicYear: '2026-2027', subject: { $in: ['subject-math', 'Mathematics'] } }],
  };
  assert.deepEqual(calls.updates[0].filter, expectedOwnerScope);
  assert.deepEqual(calls.deletes[0], expectedOwnerScope);
  assert.equal((await service.getHomeworkById(row._id, teacherA)), null);
});

test('an explicitly permitted admin can update only homework it owns without manage-any access', async () => {
  const admin = { _id: 'admin-A', role: 'school_admin', permissions: ['homework.update-own'] };
  const row = homeworkRow({ teacher: 'admin-A' });
  const { service, calls } = fixture({ homework: [row] });
  const updated = await service.updateHomework(row._id, admin, { title: 'Admin-owned update' });
  assert.equal(updated.title, 'Admin-owned update');
  assert.deepEqual(calls.updates[0].filter, {
    _id: row._id, teacher: 'admin-A', isActive: { $ne: false },
  });

  const otherRow = homeworkRow({ _id: 'other-admin-homework', teacher: 'admin-B' });
  const otherFixture = fixture({ homework: [otherRow] });
  await assert.rejects(
    otherFixture.service.deleteHomework(otherRow._id, admin),
    error => error.statusCode === 404 && error.message === 'Homework not found'
  );
});

test('teacher creation is limited to assigned class, year, and subject; unique year is derived', async () => {
  const facultyProfile = {
    _id: 'faculty-A',
    user: 'teacher-A',
    isActive: true,
    classTeacherOf: { class: '7', academicYear: '2026-2027' },
  };
  const { service, calls } = fixture({
    faculty: [facultyProfile],
    allocations: [{
      teacher: 'faculty-A', class: '8', academicYear: '2026-2027',
      subject: { _id: 'math-subject-id', name: 'Mathematics' },
    }],
  });
  const created = await service.createHomework({
    title: 'Synthetic', class: '7', subject: 'History', dueDate: new Date('2026-12-10'), teacher: 'teacher-A',
  }, teacherA);
  assert.equal(created.academicYear, '2026-2027', 'class teacher year is supplied from the server-side assignment');
  assert.equal(calls.creates.length, 1);

  await assert.rejects(service.createHomework({
    title: 'Out of class', class: '9', subject: 'Mathematics', academicYear: '2026-2027', teacher: 'teacher-A',
  }, teacherA), error => error.statusCode === 403);
  await assert.rejects(service.createHomework({
    title: 'Wrong subject', class: '8', subject: 'Science', academicYear: '2026-2027', teacher: 'teacher-A',
  }, teacherA), error => error.statusCode === 403);
  await assert.rejects(service.createHomework({
    title: 'Student-created', class: '7', subject: 'History', academicYear: '2026-2027', teacher: 'user-A',
  }, { _id: 'user-A', role: 'student' }), error => error.statusCode === 403);
  assert.equal(calls.creates.length, 1, 'unauthorized assignments must not be persisted');
});

test('missing and unauthorized IDs fail with a non-disclosing 404', async () => {
  const { service } = fixture();
  const absentTeacher = { _id: 'teacher-C', role: 'teacher' };

  for (const operation of [
    () => service.updateHomework('missing-id', teacherA, { title: 'x' }),
    () => service.deleteHomework('missing-id', teacherA),
    () => service.updateHomework('missing-id', absentTeacher, { title: 'x' }),
    () => service.deleteHomework('missing-id', absentTeacher),
  ]) {
    await assert.rejects(operation(), error => error.statusCode === 404 && error.message === 'Homework not found');
  }
});

test('student submissions are scoped, late-aware, and idempotent while other work is preserved', async () => {
  const row = homeworkRow({
    _id: '0123456789abcdef01234567',
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    submissions: [
      { _id: 'submission-B', student: 'student-B', content: 'private B', status: 'Submitted' },
    ],
  });
  const { service, calls } = fixture({
    students: [studentA],
    homework: [row],
    faculty: [teacherAFaculty],
    allocations: [teacherAMathAllocation],
  });
  const payload = {
    content: 'My completed work',
    attachments: [{ name: 'Answer sheet', url: 'https://school.example/answer' }],
  };
  const first = await service.submitHomework(row._id, { _id: 'user-A', role: 'student' }, payload);
  assert.equal(first.created, true);
  assert.equal(first.submission.status, 'submitted');
  assert.equal(first.submission.content, payload.content);
  assert.equal(first.submission.attachments[0].type, 'link');
  assert.equal(row.submissions.length, 2);
  assert.equal(row.submissions[0].content, 'private B');
  assert.equal(row.submissions[1].student, 'student-A');

  const retry = await service.submitHomework(row._id, { _id: 'user-A', role: 'student' }, payload);
  assert.equal(retry.created, false);
  assert.equal(retry.submission.content, payload.content);
  assert.equal(row.submissions.length, 2, 'an identical retry must not append a duplicate');

  await assert.rejects(
    service.submitHomework(row._id, { _id: 'user-A', role: 'student' }, { content: 'replacement' }),
    error => error.statusCode === 409
  );
  await assert.rejects(
    service.submitHomework(row._id, { _id: 'user-A', role: 'student' }, { content: 'forged', student: 'student-B' }),
    error => error.statusCode === 400
  );
  assert.equal(row.submissions.length, 2);

  await assert.rejects(
    service.submitHomework(row._id, { _id: 'teacher-A', role: 'teacher' }, payload),
    error => error.statusCode === 403
  );
  await assert.rejects(
    service.reviewSubmission(row._id, 'submission-A', {}, teacherA),
    error => error.statusCode === 501
  );
  assert.deepEqual(calls.homeworkFindOne[0], {
    class: '7', academicYear: '2026-2027', isActive: { $ne: false }, _id: row._id,
  });
  assert.deepEqual(calls.homeworkFindOne[calls.homeworkFindOne.length - 1], {
    _id: row._id, teacher: 'teacher-A', isActive: { $ne: false },
    $or: [{ class: '7', academicYear: '2026-2027', subject: { $in: ['subject-math', 'Mathematics'] } }],
  });
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.updates.length, 1, 'only the initial student submission should write');
  assert.ok(calls.updates[0].filter.submissions.$not.$elemMatch.student);
});

test('submissions after the stored due date are accepted with the existing Late status', async () => {
  const row = homeworkRow({
    _id: '1123456789abcdef01234567',
    dueDate: new Date('2000-01-01T00:00:00.000Z'),
    submissions: [],
  });
  const { service } = fixture({ students: [studentA], homework: [row] });
  const result = await service.submitHomework(
    row._id,
    { _id: 'user-A', role: 'student' },
    { content: 'Late work' }
  );
  assert.equal(result.submission.status, 'late');
});

test('submission payload accepts schema-backed text and links but rejects unsafe or forged fields', () => {
  const { normalizeHomeworkSubmission } = require('../validators/homework.validator');
  assert.deepEqual(normalizeHomeworkSubmission({ content: '  answer  ', attachments: [] }), {
    content: 'answer', attachments: [],
  });
  assert.deepEqual(normalizeHomeworkSubmission({
    content: '', attachments: [{ url: 'https://school.example/work' }],
  }), {
    content: '',
    attachments: [{ name: 'Submission link', url: 'https://school.example/work', type: 'link' }],
  });
  for (const invalid of [
    null,
    [],
    { content: 4 },
    { content: '', attachments: [] },
    { content: 'answer', student: 'student-B' },
    { content: '', attachments: [{ url: 'javascript:alert(1)' }] },
  ]) {
    assert.throws(() => normalizeHomeworkSubmission(invalid), error => error.statusCode === 400);
  }
});
