'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Models & Services
const admissionService = require('../services/admission.service');
const Admission = require('../models/Admission');
const studentService = require('../services/student.service');
const Student = require('../models/Student');
const Class = require('../models/Class');
const examService = require('../services/exam.service');
const Exam = require('../models/Exam');
const marksService = require('../services/marks.service');
const Marks = require('../models/Marks');
const AcademicYear = require('../models/AcademicYear');
const permissions = require('../config/permissions');

// Helper for stubbing functions safely
async function withStubs(stubs, callback) {
  const originals = [];
  for (const [target, key, value] of stubs) {
    originals.push([target, key, target[key]]);
    target[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
}

// -----------------------------------------------------------------------------
// WORKFLOW A: Admissions & Student Lifecycle
// -----------------------------------------------------------------------------
test('Workflow A - Admissions: rejects invalid class levels and sections', async () => {
  // Test 1: Sections are rejected
  await assert.rejects(
    () => admissionService.applyForAdmission({ studentName: 'Test', section: 'A' }),
    { message: /Class sections are not supported/ }
  );

  // Test 2: Invalid/Legacy Class names like Pre-Nursery are rejected
  await assert.rejects(
    () => admissionService.applyForAdmission({ studentName: 'Test', classApplyingFor: 'Pre-Nursery' }),
    { message: /not an approved school class level/ }
  );
});

test('Workflow A - Admissions: enforces valid status transition flow', async () => {
  const fakeAdmissionId = new mongoose.Types.ObjectId();
  
  // Status transition from Submitted to Under_Review is valid
  await withStubs([
    [Admission, 'findById', () => ({
      select: () => Promise.resolve({
        _id: fakeAdmissionId,
        status: 'Submitted',
      })
    })],
    [Admission, 'findOneAndUpdate', () => Promise.resolve({
      _id: fakeAdmissionId,
      status: 'Under_Review',
    })]
  ], async () => {
    const updated = await admissionService.updateAdmissionStatus(fakeAdmissionId, 'Under_Review');
    assert.equal(updated.status, 'Under_Review');
  });

  // Invalid transition: Rejected cannot transition to Approved
  await withStubs([
    [Admission, 'findById', () => ({
      select: () => Promise.resolve({
        _id: fakeAdmissionId,
        status: 'Rejected',
      })
    })]
  ], async () => {
    await assert.rejects(
      () => admissionService.updateAdmissionStatus(fakeAdmissionId, 'Approved'),
      { message: /Invalid admission status transition/ }
    );
  });
});

// -----------------------------------------------------------------------------
// WORKFLOW B: Student & Class Management
// -----------------------------------------------------------------------------
test('Workflow B - Student Management: canonical class levels and section prevention', () => {
  // Canonical class levels: Nursery, LKG, UKG, 1..12 (aliases KG-1 -> LKG, KG-2 -> UKG)
  assert.equal(Class.validateAndNormalizeClassWrite('Nursery', 'class'), 'Nursery');
  assert.equal(Class.validateAndNormalizeClassWrite('KG-1', 'class'), 'LKG');
  assert.equal(Class.validateAndNormalizeClassWrite('LKG', 'class'), 'LKG');
  assert.equal(Class.validateAndNormalizeClassWrite('KG-2', 'class'), 'UKG');
  assert.equal(Class.validateAndNormalizeClassWrite('UKG', 'class'), 'UKG');
  assert.equal(Class.validateAndNormalizeClassWrite('1', 'class'), '1');
  assert.equal(Class.validateAndNormalizeClassWrite('12', 'class'), '12');

  // Section rejection
  assert.throws(
    () => Class.validateAndNormalizeClassWrite('10-A', 'class'),
    /Class sections are not supported/
  );
});

test('Workflow B - Student Management: student promotion rejects promotion to Pre-Nursery', async () => {
  const studentId = new mongoose.Types.ObjectId();
  const student = {
    _id: studentId,
    class: 'Pre-Nursery', // legacy student record
    academicYear: '2026-2027',
    enrollmentEffectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    save: async () => student,
  };

  const targetYear = {
    name: '2027-2028',
    startDate: new Date('2027-04-01T00:00:00.000Z'),
    endDate: new Date('2028-03-31T23:59:59.999Z'),
  };

  await withStubs([
    [Student, 'findById', () => Promise.resolve(student)],
    [AcademicYear, 'findOne', () => ({
      select: () => Promise.resolve(targetYear)
    })]
  ], async () => {
    // Attempting to explicitly transfer/promote a student into 'Pre-Nursery' is blocked
    await assert.rejects(
      () => studentService.promoteStudents([studentId], undefined, '2027-2028', {
        sourceAcademicYear: '2026-2027',
        sourceClass: 'Pre-Nursery',
        actor: { _id: new mongoose.Types.ObjectId() },
      }),
      { message: /not an approved school class level/ }
    );
  });
});

// -----------------------------------------------------------------------------
// WORKFLOW D: Exams, Marks, and Results
// -----------------------------------------------------------------------------
test('Workflow D - Exams: schedule creation rejects non-consecutive academic years', async () => {
  // Calling createExam with non-consecutive academic year throws
  await assert.rejects(
    () => examService.createExam({
      name: 'Midterm',
      class: '10',
      academicYear: '2026-2028', // Non-consecutive
      examType: 'Midterm',
      startDate: new Date(),
      endDate: new Date(),
    }),
    { message: /Academic year must use consecutive YYYY-YYYY dates/ }
  );
});

test('Workflow D - Marks: access control enforces marks.enter role permissions', async () => {
  // Actor with unprivileged role (e.g., student) cannot enter marks
  const unprivilegedUser = {
    _id: new mongoose.Types.ObjectId(),
    role: 'student',
  };

  await assert.rejects(
    () => marksService.addOrUpdateMarks({
      student: new mongoose.Types.ObjectId(),
      class: '10',
      academicYear: '2026-2027',
      examType: 'Midterm',
      subjects: [{ subject: 'Math', marksObtained: 80, maxMarks: 100 }],
    }, unprivilegedUser),
    { statusCode: 403, message: /Role is not authorized to enter marks/ }
  );
});

// -----------------------------------------------------------------------------
// WORKFLOW H: Permissions and RBAC Contract Integrity
// -----------------------------------------------------------------------------
test('Workflow H - RBAC: Parent has read-only/linked permissions and cannot write', () => {
  const parentPermissions = permissions.PERMISSIONS.PARENT || [];
  
  // Parent must have view-linked permissions
  assert.ok(parentPermissions.includes('attendance.view-linked'));
  assert.ok(parentPermissions.includes('results.view-linked'));
  assert.ok(parentPermissions.includes('fees.view-linked'));

  // Parent must NEVER have write permissions
  assert.ok(!parentPermissions.includes('attendance.mark'));
  assert.ok(!parentPermissions.includes('marks.enter'));
  assert.ok(!parentPermissions.includes('homework.create'));
  assert.ok(!parentPermissions.includes('fees.collect'));
  assert.ok(!parentPermissions.includes('fees.create'));
  assert.ok(!parentPermissions.includes('admissions.approve'));
});

test('Workflow H - RBAC: Teacher cannot create fee structures or approve admissions', () => {
  const teacherPermissions = permissions.PERMISSIONS.TEACHER || [];
  
  assert.ok(!teacherPermissions.includes('fees.create'));
  assert.ok(!teacherPermissions.includes('fees.collect'));
  assert.ok(!teacherPermissions.includes('admissions.approve'));
  assert.ok(!teacherPermissions.includes('notices.publish'));
});
