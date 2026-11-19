'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const User = require('../models/User');
const Student = require('../models/Student');
const AcademicYear = require('../models/AcademicYear');
const studentService = require('../services/student.service');
const {
  rejectLegacyStudentFinancialFields,
} = require('../validators/student.validator');

const validCreate = () => ({
  name: 'Synthetic Student',
  email: 'synthetic.student@example.invalid',
  password: 'synthetic-password',
  gender: 'female',
  dateOfBirth: '2010-01-01',
  phone: '9876543210',
  address: { street: '1 Test Road', city: 'Test City', state: 'Test State', pincode: '123456' },
  rollNumber: 7,
  class: '6',
  academicYear: '2026-2027',
  enrollmentEffectiveFrom: '2026-04-01',
  father: { name: 'Synthetic Father', phone: '9876543211' },
  mother: { name: 'Synthetic Mother' },
});

async function withStubs(stubs, callback) {
  const originals = [];
  for (const [target, key, value] of stubs) {
    originals.push([target, key, target[key]]);
    target[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [target, key, original] of originals.reverse()) target[key] = original;
  }
}

function makeFinancePicker({ response, error } = {}) {
  const calls = [];
  const select = {
    children: [],
    disabled: false,
    replaceChildren(...children) { this.children = children; },
  };
  const document = {
    getElementById(id) {
      if (id === 'collSearchClass') return { value: '6' };
      if (id === 'collSearchStudent') return select;
      throw new Error(`Unexpected element: ${id}`);
    },
  };
  function Option(text, value) { this.text = text; this.value = value; }
  const context = {
    window: {},
    document,
    Option,
    initPortal() {},
    loadNoticesFull() {},
    loadEvents() {},
    apiFetch: async (url) => {
      calls.push(url);
      if (error) throw error;
      return response;
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'finance-portal.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'finance-portal.js' });
  return { calls, select, load: context.window.loadStudentsForCollection };
}

test('student create uses a server-owned role and explicit allowlists, including nested fields', async () => {
  const calls = {};
  await withStubs([
    [User, 'findOne', async () => null],
    [User, 'create', async (document) => { calls.user = document; return { _id: 'user-1', name: document.name }; }],
    [Student, 'create', async (document) => { calls.student = document; return document; }],
    [AcademicYear, 'find', () => ({
      select: () => ({
        lean: async () => [{
          name: '2026-2027',
          startDate: new Date('2026-04-01T00:00:00.000Z'),
          endDate: new Date('2027-03-31T23:59:59.999Z'),
        }],
      }),
    })],
  ], async () => {
    await studentService.createStudent(validCreate(), 'admin-1');
  });

  assert.equal(calls.user.role, 'student');
  assert.equal(calls.student.rollNumber, 7);
  assert.equal(calls.student.father.name, 'Synthetic Father');
  assert.deepEqual(calls.student.father, { name: 'Synthetic Father', phone: '9876543211' });
  assert.deepEqual(calls.user.address, { street: '1 Test Road', city: 'Test City', state: 'Test State', pincode: '123456' });
  assert.equal(Object.hasOwn(calls.student, 'fees'), false);
  assert.equal(Object.hasOwn(calls.student, 'isActive'), false);
});

test('student creation rejects missing, null, or empty required family names before persistence', async () => {
  const invalidInputs = [
    { ...validCreate(), father: null },
    { ...validCreate(), mother: null },
    { ...validCreate(), father: {} },
    { ...validCreate(), mother: {} },
    { ...validCreate(), father: { phone: '9876543211' } },
    { ...validCreate(), mother: { occupation: 'Synthetic' } },
    { ...validCreate(), father: { name: null } },
    { ...validCreate(), mother: { name: '   ' } },
  ];
  let databaseReads = 0;
  for (const input of invalidInputs) {
    await withStubs([
      [User, 'findOne', async () => { databaseReads += 1; return null; }],
    ], async () => {
      await assert.rejects(studentService.createStudent(input, 'admin-1'), error => error.statusCode === 400);
    });
  }
  assert.equal(databaseReads, 0);
});

test('student updates reject null, empty, malformed, or name-erasing family updates before writes', async () => {
  const invalidInputs = [
    { father: null },
    { mother: null },
    { father: {} },
    { mother: {} },
    { father: [] },
    { mother: 'Synthetic Mother' },
    { father: { name: null } },
    { mother: { name: '' } },
    { father: { name: 'Synthetic Father', unexpected: true } },
  ];
  let reads = 0;
  let writes = 0;
  for (const input of invalidInputs) {
    reads = 0;
    writes = 0;
    await withStubs([
      [Student, 'findById', async () => {
        reads += 1;
        return { _id: 'student-1', user: 'user-1', father: { name: 'Stored Father' }, mother: { name: 'Stored Mother' } };
      }],
      [User, 'findByIdAndUpdate', async () => { writes += 1; }],
      [Student, 'findByIdAndUpdate', () => { writes += 1; throw new Error('Unexpected persistence'); }],
    ], async () => {
      await assert.rejects(studentService.updateStudent('student-1', input), error => error.statusCode === 400);
    });
    assert.equal(writes, 0);
    assert.ok(reads === 0 || reads === 1);
  }
});

test('partial family edits preserve stored required names and address null remains an allowed clear', async () => {
  const calls = {};
  await withStubs([
    [Student, 'findById', async () => ({
      _id: 'student-1', user: 'user-1', father: { name: 'Stored Father' }, mother: { name: 'Stored Mother' },
    })],
    [User, 'findByIdAndUpdate', async (id, update) => { calls.userUpdate = { id, update }; }],
    [Student, 'findByIdAndUpdate', (id, update) => {
      calls.studentUpdate = { id, update };
      return { populate: async () => ({ _id: id }) };
    }],
  ], async () => {
    await studentService.updateStudent('student-1', {
      father: { phone: '9876543211' },
      mother: { name: 'Updated Mother' },
      address: null,
    });
  });
  assert.deepEqual(calls.userUpdate.update, { $set: { address: null } });
  assert.deepEqual(calls.studentUpdate.update, {
    $set: { father: { phone: '9876543211' }, mother: { name: 'Updated Mother' } },
  });
});

test('student creation rejects legacy financial and protected lifecycle fields before creating records', async () => {
  const forbiddenInputs = [
    { fees: { totalFees: 100, paidFees: 100, discount: 0 } },
    { paidFees: 100 },
    { totalFees: 100 },
    { 'fees.paidFees': 100 },
    { isActive: false },
    { parentUser: 'parent-1' },
    { tcIssued: true },
    { enrollmentHistory: [] },
  ];
  let reads = 0;
  for (const forbidden of forbiddenInputs) {
    await withStubs([
      [User, 'findOne', async () => { reads += 1; return null; }],
    ], async () => {
      await assert.rejects(
        studentService.createStudent({ ...validCreate(), ...forbidden }, 'admin-1'),
        error => error.statusCode === 400 && /financial fields|unsupported student field/i.test(error.message)
      );
    });
  }
  assert.equal(reads, 0);

  let forwarded;
  rejectLegacyStudentFinancialFields({ body: { fees: { paidFees: 10 } } }, {}, error => { forwarded = error; });
  assert.equal(forwarded.statusCode, 400);
  assert.match(forwarded.message, /fee ledger workflow/);
});

test('student updates allow profile fields but reject financial and protected fields before database writes', async () => {
  const calls = {};
  const updated = { _id: 'student-1', user: 'user-1', rollNumber: 8, father: { name: 'Updated Father' } };
  await withStubs([
    [Student, 'findById', async () => ({ _id: 'student-1', user: 'user-1' })],
    [User, 'findByIdAndUpdate', async (id, update) => { calls.userUpdate = { id, update }; }],
    [Student, 'findByIdAndUpdate', (id, update) => {
      calls.studentUpdate = { id, update };
      return { populate: async () => updated };
    }],
  ], async () => {
    const result = await studentService.updateStudent('student-1', {
      name: 'Synthetic Student Updated',
      rollNumber: 8,
      father: { name: 'Updated Father' },
    });
    assert.equal(result, updated);
  });
  assert.deepEqual(calls.userUpdate.update, { $set: { name: 'Synthetic Student Updated' } });
  assert.deepEqual(calls.studentUpdate.update, {
    $set: { rollNumber: 8, father: { name: 'Updated Father' } },
  });

  await withStubs([
    [Student, 'findById', async () => { throw new Error('Nested protected field should reject before database access'); }],
  ], async () => {
    await assert.rejects(
      studentService.updateStudent('student-1', { father: { name: 'Synthetic Father', tcIssued: true } }),
      error => error.statusCode === 400
    );
  });

  for (const forbidden of [
    { fees: { totalFees: 100, paidFees: 50, discount: 10 } },
    { paidFees: 50 },
    { isActive: false },
    { parentUser: 'other-parent' },
    { tcIssued: true },
    { enrollmentHistory: [] },
    { admissionNumber: 'FORGED' },
  ]) {
    let databaseReads = 0;
    await withStubs([
      [Student, 'findById', async () => { databaseReads += 1; return null; }],
    ], async () => {
      await assert.rejects(
        studentService.updateStudent('student-1', forbidden),
        error => error.statusCode === 400
      );
    });
    assert.equal(databaseReads, 0);
  }
});

test('Accountant finance picker uses the basic-permission student list endpoint and actual response shape', async () => {
  const picker = makeFinancePicker({
    response: {
      success: true,
      students: [{ _id: 'student-1', admissionNumber: 'SYN-1', user: { name: 'Synthetic Student' } }],
    },
  });
  await picker.load();
  assert.deepEqual(picker.calls, ['/students?class=6&limit=1000']);
  assert.equal(picker.select.children[0].text, 'Select Student');
  assert.equal(picker.select.children[1].value, 'student-1');
  assert.equal(picker.select.children[1].text, 'Synthetic Student (SYN-1)');
  assert.equal(picker.select.disabled, false);

  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'student.routes.js'), 'utf8');
  const accessService = fs.readFileSync(path.join(__dirname, '..', 'services', 'student-access.service.js'), 'utf8');
  assert.match(routes, /requirePermission\('students\.view',\s*'students\.view-basic'\), getAllStudents/);
  assert.match(accessService, /BASIC_STUDENT_FIELDS\s*=\s*'admissionNumber class rollNumber academicYear isActive user'/);
});

test('finance picker distinguishes empty, unauthorized, malformed, and failed responses', async (t) => {
  const cases = [
    { name: 'empty class', response: { success: true, students: [] }, expected: 'No students found in this class' },
    { name: 'forbidden', error: { status: 403 }, expected: 'Not authorized to view students' },
    { name: 'network failure', error: { status: 0 }, expected: 'Could not load students; check your connection' },
    { name: 'malformed response', response: { success: true, data: { students: [] } }, expected: 'Student list unavailable' },
    { name: 'server failure', error: { status: 500 }, expected: 'Student list unavailable' },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const picker = makeFinancePicker(scenario);
      await picker.load();
      assert.equal(picker.select.children[0].text, scenario.expected);
      assert.equal(picker.select.disabled, true);
    });
  }
});

