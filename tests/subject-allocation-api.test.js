'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const SubjectAllocation = require('../models/SubjectAllocation');
const Faculty = require('../models/Faculty');
const Subject = require('../models/Subject');
const AcademicYear = require('../models/AcademicYear');
const Class = require('../models/Class');
const subjectAllocationService = require('../services/subject-allocation.service');
const permissions = require('../config/permissions');
const { requirePermission } = require('../middleware/authorization.middleware');

const VALID_ID = '64f000000000000000000001';
const TEACHER_ID = '64f000000000000000000010';
const SUBJECT_ID = '64f000000000000000000020';

function allocation(overrides = {}) {
  return {
    _id: VALID_ID,
    teacher: TEACHER_ID,
    subject: SUBJECT_ID,
    class: '5',
    academicYear: '2026-2027',
    toObject() { return { ...this }; },
    ...overrides,
  };
}

async function withStubs(stubs, callback) {
  const originals = stubs.map(([target, key]) => [target, key, target[key]]);
  stubs.forEach(([target, key, value]) => { target[key] = value; });
  try {
    return await callback();
  } finally {
    originals.reverse().forEach(([target, key, value]) => { target[key] = value; });
  }
}

test('subject-allocation permissions: subjects.manage for mutations, subjects.view for reads', () => {
  assert.ok(permissions.PERMISSIONS.ACADEMIC_COORDINATOR.includes('subjects.manage'));
  assert.ok(permissions.PERMISSIONS.ACADEMIC_COORDINATOR.includes('subjects.view'));
  assert.ok(permissions.PERMISSIONS.SCHOOL_ADMIN.includes('subjects.manage'));
  assert.ok(permissions.PERMISSIONS.SCHOOL_ADMIN.includes('subjects.view'));
  for (const role of ['teacher', 'student', 'parent']) {
    let forwarded;
    requirePermission('subjects.manage')(
      { user: { role, permissions: [] } }, {}, error => { forwarded = error; }
    );
    assert.equal(forwarded.statusCode, 403);
  }
});

test('subject-allocation routes are protected and expose CRUD operations', () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'subject-allocation.routes.js'), 'utf8'
  );
  assert.match(routeSource, /router\.use\(protect\)/);
  assert.ok(routeSource.includes("router.get('/', requirePermission('subjects.view')"));
  assert.ok(routeSource.includes("router.post('/', requirePermission('subjects.manage')"));
  assert.ok(routeSource.includes("router.get('/:id', requirePermission('subjects.view')"));
  assert.ok(routeSource.includes("router.put('/:id', requirePermission('subjects.manage')"));
  assert.ok(routeSource.includes("router.delete('/:id', requirePermission('subjects.manage')"));
});

test('subject-allocation model enforces compound unique index', () => {
  const indexes = SubjectAllocation.schema.indexes();
  const compoundIndex = indexes.find(([keys]) =>
    keys.teacher === 1 && keys.subject === 1 && keys.class === 1 && keys.academicYear === 1
  );
  assert.ok(compoundIndex, 'Compound unique index on {teacher, subject, class, academicYear} must exist');
  assert.equal(compoundIndex[1].unique, true);
});

test('subject-allocation model rejects Pre-Nursery and normalizes valid class levels', () => {
  assert.ok(SubjectAllocation.CANONICAL_CLASS_LEVELS);
  assert.ok(!SubjectAllocation.CANONICAL_CLASS_LEVELS.includes('Pre-Nursery'));
  assert.ok(SubjectAllocation.CANONICAL_CLASS_LEVELS.includes('Nursery'));
  assert.ok(SubjectAllocation.CANONICAL_CLASS_LEVELS.includes('12'));
});

test('subject-allocation service rejects missing required fields', async () => {
  await assert.rejects(
    subjectAllocationService.createAllocation({}),
    error => error.statusCode === 400 && /required/.test(error.message)
  );
  await assert.rejects(
    subjectAllocationService.createAllocation({ teacher: TEACHER_ID }),
    error => error.statusCode === 400 && /required/.test(error.message)
  );
});

test('subject-allocation service rejects non-existent teacher', async () => {
  await withStubs([
    [Faculty, 'findById', () => ({ select: () => ({ lean: async () => null }) })],
  ], async () => {
    await assert.rejects(
      subjectAllocationService.createAllocation({
        teacher: TEACHER_ID, subject: SUBJECT_ID, class: '5', academicYear: '2026-2027',
      }),
      error => error.statusCode === 400 && /teacher does not exist/i.test(error.message)
    );
  });
});

test('subject-allocation service rejects non-existent subject', async () => {
  await withStubs([
    [Faculty, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: TEACHER_ID }) }) })],
    [Subject, 'findById', () => ({ select: () => ({ lean: async () => null }) })],
  ], async () => {
    await assert.rejects(
      subjectAllocationService.createAllocation({
        teacher: TEACHER_ID, subject: SUBJECT_ID, class: '5', academicYear: '2026-2027',
      }),
      error => error.statusCode === 400 && /subject does not exist/i.test(error.message)
    );
  });
});

test('subject-allocation service rejects subject not offered for target class', async () => {
  await withStubs([
    [Faculty, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: TEACHER_ID }) }) })],
    [Subject, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: SUBJECT_ID, classLevels: ['6', '7', '8'] }) }) })],
    [AcademicYear, 'findOne', () => ({ select: () => ({ lean: async () => ({ _id: 'ayid' }) }) })],
  ], async () => {
    await assert.rejects(
      subjectAllocationService.createAllocation({
        teacher: TEACHER_ID, subject: SUBJECT_ID, class: '5', academicYear: '2026-2027',
      }),
      error => error.statusCode === 400 && /not offered for class/i.test(error.message)
    );
  });
});

test('subject-allocation service rejects invalid academic year format', async () => {
  await withStubs([
    [Faculty, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: TEACHER_ID }) }) })],
    [Subject, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: SUBJECT_ID, classLevels: ['5'] }) }) })],
  ], async () => {
    await assert.rejects(
      subjectAllocationService.createAllocation({
        teacher: TEACHER_ID, subject: SUBJECT_ID, class: '5', academicYear: '2026-2028',
      }),
      error => error.statusCode === 400 && /consecutive/.test(error.message)
    );
  });
});

test('subject-allocation service rejects non-existent academic year', async () => {
  await withStubs([
    [Faculty, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: TEACHER_ID }) }) })],
    [Subject, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: SUBJECT_ID, classLevels: ['5'] }) }) })],
    [AcademicYear, 'findOne', () => ({ select: () => ({ lean: async () => null }) })],
  ], async () => {
    await assert.rejects(
      subjectAllocationService.createAllocation({
        teacher: TEACHER_ID, subject: SUBJECT_ID, class: '5', academicYear: '2026-2027',
      }),
      error => error.statusCode === 400 && /does not exist/.test(error.message)
    );
  });
});

test('subject-allocation service creates a valid allocation', async () => {
  let created = null;
  await withStubs([
    [Faculty, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: TEACHER_ID }) }) })],
    [Subject, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: SUBJECT_ID, classLevels: ['5', '6'] }) }) })],
    [AcademicYear, 'findOne', () => ({ select: () => ({ lean: async () => ({ _id: 'ayid' }) }) })],
    [SubjectAllocation, 'create', async (data) => { created = data; return allocation(data); }],
  ], async () => {
    const result = await subjectAllocationService.createAllocation({
      teacher: TEACHER_ID, subject: SUBJECT_ID, class: '5', academicYear: '2026-2027',
    });
    assert.equal(result.teacher, TEACHER_ID);
    assert.equal(result.subject, SUBJECT_ID);
    assert.equal(result.class, '5');
    assert.equal(result.academicYear, '2026-2027');
    assert.ok(created);
  });
});

test('subject-allocation service maps duplicate key error to 409', async () => {
  await withStubs([
    [Faculty, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: TEACHER_ID }) }) })],
    [Subject, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: SUBJECT_ID, classLevels: ['5'] }) }) })],
    [AcademicYear, 'findOne', () => ({ select: () => ({ lean: async () => ({ _id: 'ayid' }) }) })],
    [SubjectAllocation, 'create', async () => { const e = new Error('dup'); e.code = 11000; throw e; }],
  ], async () => {
    await assert.rejects(
      subjectAllocationService.createAllocation({
        teacher: TEACHER_ID, subject: SUBJECT_ID, class: '5', academicYear: '2026-2027',
      }),
      error => error.statusCode === 409 && /already exists/.test(error.message)
    );
  });
});

test('subject-allocation service retrieves by ID and returns 404 for missing', async () => {
  await withStubs([
    [SubjectAllocation, 'findById', () => ({
      populate: () => ({ populate: async () => allocation() }),
    })],
  ], async () => {
    const result = await subjectAllocationService.getAllocationById(VALID_ID);
    assert.equal(result.teacher, TEACHER_ID);
  });

  await withStubs([
    [SubjectAllocation, 'findById', () => ({
      populate: () => ({ populate: async () => null }),
    })],
  ], async () => {
    await assert.rejects(
      subjectAllocationService.getAllocationById(VALID_ID),
      error => error.statusCode === 404
    );
  });
});

test('subject-allocation service deletes by ID and returns 404 for missing', async () => {
  await withStubs([
    [SubjectAllocation, 'findByIdAndDelete', async () => allocation()],
  ], async () => {
    const result = await subjectAllocationService.deleteAllocation(VALID_ID);
    assert.equal(result._id, VALID_ID);
  });

  await withStubs([
    [SubjectAllocation, 'findByIdAndDelete', async () => null],
  ], async () => {
    await assert.rejects(
      subjectAllocationService.deleteAllocation(VALID_ID),
      error => error.statusCode === 404
    );
  });
});

test('subject-allocation server.js mounts at /api/v1/subject-allocations', () => {
  const serverSource = fs.readFileSync(
    path.join(__dirname, '..', 'server.js'), 'utf8'
  );
  assert.ok(
    serverSource.includes("'subject-allocation': 'subject-allocations'"),
    'pathMap must include subject-allocation → subject-allocations mapping'
  );
});

test('subject-allocation server.js mounts settings at /api/v1/settings (not settingss)', () => {
  const serverSource = fs.readFileSync(
    path.join(__dirname, '..', 'server.js'), 'utf8'
  );
  assert.ok(
    serverSource.includes("settings:     'settings'"),
    'pathMap must include settings → settings mapping for settings.routes.js'
  );
});
