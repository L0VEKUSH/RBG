'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const AcademicYear = require('../models/AcademicYear');
const AuditLog = require('../models/AuditLog');
const academicYearService = require('../services/academic-year.service');
const permissions = require('../config/permissions');
const { requirePermission } = require('../middleware/authorization.middleware');

const VALID_ID = '64f000000000000000000001';

function academicYear(overrides = {}) {
  return {
    _id: VALID_ID,
    name: '2026-2027',
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2027-03-31T00:00:00.000Z'),
    terms: [],
    isActive: true,
    isCurrent: false,
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

function validationError(message) {
  const error = new mongoose.Error.ValidationError();
  error.addError('startDate', new mongoose.Error.ValidatorError({ message }));
  return error;
}

test('academic-year permissions allow administrators and deny non-administrators', () => {
  assert.ok(permissions.PERMISSIONS.PRINCIPAL.includes('academic-years.manage'));
  assert.ok(permissions.PERMISSIONS.SCHOOL_ADMIN.includes('academic-years.manage'));
  for (const role of ['teacher', 'student', 'parent']) {
    let forwarded;
    requirePermission('academic-years.manage')(
      { user: { role, permissions: [] } }, {}, error => { forwarded = error; }
    );
    assert.equal(forwarded.statusCode, 403);
  }
});

test('academic-year routes are protected and expose the required operations', () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'academic-year.routes.js'), 'utf8'
  );
  assert.match(routeSource, /router\.use\(protect\)/);
  assert.ok(routeSource.includes("router.get('/', requirePermission('academic-years.view')"));
  assert.ok(routeSource.includes("router.post('/', requirePermission('academic-years.manage')"));
  assert.ok(routeSource.includes("router.put('/:id', requirePermission('academic-years.manage')"));
  assert.ok(routeSource.includes("router.patch('/:id/activate', requirePermission('academic-years.manage')"));
  assert.ok(routeSource.includes("router.patch('/:id/deactivate', requirePermission('academic-years.manage')"));
  assert.ok(routeSource.includes("router.patch('/:id/establish-current', requirePermission('academic-years.manage')"));
  assert.ok(routeSource.includes("router.post('/:id/establish-current', requirePermission('academic-years.manage')"));
});

test('academic-year service lists and retrieves records', async () => {
  const rows = [academicYear()];
  await withStubs([
    [AcademicYear, 'find', () => ({ sort: () => Promise.resolve(rows) })],
    [AcademicYear, 'findById', async () => rows[0]],
  ], async () => {
    assert.deepEqual(await academicYearService.listAcademicYears(), rows);
    assert.equal(await academicYearService.getAcademicYear(VALID_ID), rows[0]);
  });
});

test('academic-year service creates valid records with school-local date boundaries', async () => {
  let payload;
  await withStubs([
    [AcademicYear, 'create', async value => {
      payload = value;
      return academicYear(value);
    }],
  ], async () => {
    const created = await academicYearService.createAcademicYear({
      name: '2026-2027',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
    });
    assert.equal(created.name, '2026-2027');
    assert.equal(payload.startDate.toISOString(), '2026-03-31T18:30:00.000Z');
    assert.equal(payload.endDate.toISOString(), '2027-03-30T18:30:00.000Z');
  });
});

test('academic-year service rejects invalid input, protected fields, and duplicate names', async () => {
  await assert.rejects(
    academicYearService.createAcademicYear({
      name: '2026-2028', startDate: '2026-04-01', endDate: '2027-03-31',
    }),
    error => error.statusCode === 400 && /consecutive/.test(error.message)
  );
  await assert.rejects(
    academicYearService.createAcademicYear({
      name: '2026-2027', startDate: '2026-02-30', endDate: '2027-03-31',
    }),
    error => error.statusCode === 400 && /valid/.test(error.message)
  );
  await withStubs([
    [AcademicYear, 'findById', async () => academicYear()],
  ], async () => {
    await assert.rejects(
      academicYearService.updateAcademicYear(VALID_ID, { isCurrent: true }),
      error => error.statusCode === 400 && /cannot be changed/.test(error.message)
    );
  });
  await withStubs([
    [AcademicYear, 'create', async () => { throw { code: 11000 }; }],
  ], async () => {
    await assert.rejects(
      academicYearService.createAcademicYear({
        name: '2026-2027', startDate: '2026-04-01', endDate: '2027-03-31',
      }),
      error => error.statusCode === 409 && /already exists/.test(error.message)
    );
  });
});

test('academic-year service updates an existing record and rejects missing or invalid IDs', async () => {
  const row = academicYear();
  let saved = 0;
  row.save = async () => { saved += 1; return row; };
  await withStubs([
    [AcademicYear, 'findById', async () => row],
  ], async () => {
    const updated = await academicYearService.updateAcademicYear(VALID_ID, {
      name: '2027-2028',
      startDate: '2027-04-01',
      endDate: '2028-03-31',
    });
    assert.equal(updated.name, '2027-2028');
    assert.equal(saved, 1);
    await assert.rejects(
      academicYearService.getAcademicYear('not-an-id'),
      error => error.statusCode === 404
    );
  });
});

test('academic-year activation toggles only isActive and protects the current year', async () => {
  const inactive = academicYear({ isActive: false });
  let saved = 0;
  inactive.save = async () => { saved += 1; return inactive; };
  await withStubs([
    [AcademicYear, 'findById', async () => inactive],
  ], async () => {
    await academicYearService.activateAcademicYear(VALID_ID);
    assert.equal(inactive.isActive, true);
    assert.equal(inactive.isCurrent, false);
    assert.equal(saved, 1);
  });

  const current = academicYear({ isCurrent: true });
  await withStubs([
    [AcademicYear, 'findById', async () => current],
  ], async () => {
    await assert.rejects(
      academicYearService.deactivateAcademicYear(VALID_ID),
      error => error.statusCode === 409 && /current academic year/.test(error.message)
    );
  });
});

test('academic-year deactivation is idempotent for an already inactive year', async () => {
  const inactive = academicYear({ isActive: false });
  let saved = 0;
  inactive.save = async () => { saved += 1; return inactive; };
  await withStubs([
    [AcademicYear, 'findById', async () => inactive],
  ], async () => {
    await academicYearService.deactivateAcademicYear(VALID_ID);
    assert.equal(saved, 0);
  });
});

test('academic-year service preserves overlap validation errors from the model', async () => {
  await withStubs([
    [AcademicYear, 'create', async () => {
      throw validationError('Active academic year dates overlap another active academic year.');
    }],
  ], async () => {
    await assert.rejects(
      academicYearService.createAcademicYear({
        name: '2026-2027', startDate: '2026-04-01', endDate: '2027-03-31',
      }),
      error => error.name === 'ValidationError' &&
        /overlap another active academic year/.test(error.errors.startDate.message)
    );
  });
});

test('academic-year establishCurrentAcademicYear establishes initial current year and records audit log', async () => {
  const actor = { _id: '64f000000000000000000099' };
  const targetYear = academicYear({ _id: VALID_ID, name: '2026-2027', isActive: true, isCurrent: false });
  let saved = 0;
  targetYear.save = async () => { saved += 1; return targetYear; };

  let recordedAudit = null;
  const mockSession = {
    async withTransaction(fn) {
      return await fn();
    },
    async endSession() {},
  };

  await withStubs([
    [mongoose, 'startSession', async () => mockSession],
    [AcademicYear, 'findById', (id) => ({
      session: () => Promise.resolve(targetYear),
    })],
    [AcademicYear, 'findOne', (query) => ({
      session: () => Promise.resolve(null),
    })],
    [AuditLog, 'create', async (entries) => {
      recordedAudit = entries[0];
      return entries;
    }],
  ], async () => {
    const result = await academicYearService.establishCurrentAcademicYear(VALID_ID, actor, {
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });
    assert.equal(result.isCurrent, true);
    assert.equal(saved, 1);
    assert.ok(recordedAudit);
    assert.equal(recordedAudit.action, 'academic_year_establish_current');
    assert.equal(recordedAudit.resource, 'AcademicYear');
    assert.equal(recordedAudit.resourceId, VALID_ID);
    assert.equal(recordedAudit.user, actor._id);
    assert.equal(recordedAudit.ipAddress, '127.0.0.1');
  });
});

test('academic-year establishCurrentAcademicYear rejects invalid candidate, inactive, already-current, or existing current', async () => {
  const actor = { _id: '64f000000000000000000099' };
  const mockSession = {
    async withTransaction(fn) { return await fn(); },
    async endSession() {},
  };

  // Missing / unauthenticated actor
  await assert.rejects(
    academicYearService.establishCurrentAcademicYear(VALID_ID, null),
    error => error.statusCode === 401
  );

  // Inactive year
  const inactiveYear = academicYear({ _id: VALID_ID, isActive: false, isCurrent: false });
  await withStubs([
    [mongoose, 'startSession', async () => mockSession],
    [AcademicYear, 'findById', () => ({ session: () => Promise.resolve(inactiveYear) })],
  ], async () => {
    await assert.rejects(
      academicYearService.establishCurrentAcademicYear(VALID_ID, actor),
      error => error.statusCode === 400 && /inactive/.test(error.message)
    );
  });

  // Already current
  const alreadyCurrent = academicYear({ _id: VALID_ID, isActive: true, isCurrent: true });
  await withStubs([
    [mongoose, 'startSession', async () => mockSession],
    [AcademicYear, 'findById', () => ({ session: () => Promise.resolve(alreadyCurrent) })],
  ], async () => {
    await assert.rejects(
      academicYearService.establishCurrentAcademicYear(VALID_ID, actor),
      error => error.statusCode === 409 && /already marked as current/.test(error.message)
    );
  });

  // Another year is already current
  const targetYear = academicYear({ _id: VALID_ID, isActive: true, isCurrent: false });
  const existingCurrent = academicYear({ _id: '64f000000000000000000002', name: '2025-2026', isCurrent: true });
  await withStubs([
    [mongoose, 'startSession', async () => mockSession],
    [AcademicYear, 'findById', () => ({ session: () => Promise.resolve(targetYear) })],
    [AcademicYear, 'findOne', () => ({ session: () => Promise.resolve(existingCurrent) })],
  ], async () => {
    await assert.rejects(
      academicYearService.establishCurrentAcademicYear(VALID_ID, actor),
      error => error.statusCode === 409 && /rollover workflow/.test(error.message)
    );
  });
});

test('academic-year establishCurrentAcademicYear handles duplicate key error and unsupported transaction', async () => {
  const actor = { _id: '64f000000000000000000099' };

  // Duplicate key error (code 11000)
  const dupSession = {
    async withTransaction() {
      const err = new Error('Duplicate key on isCurrent');
      err.code = 11000;
      throw err;
    },
    async endSession() {},
  };
  await withStubs([
    [mongoose, 'startSession', async () => dupSession],
  ], async () => {
    await assert.rejects(
      academicYearService.establishCurrentAcademicYear(VALID_ID, actor),
      error => error.statusCode === 409 && /concurrently established/.test(error.message)
    );
  });

  // Unsupported transaction (code 20)
  const unsuppSession = {
    async withTransaction() {
      const err = new Error('Transactions are not supported on this deployment');
      err.code = 20;
      throw err;
    },
    async endSession() {},
  };
  await withStubs([
    [mongoose, 'startSession', async () => unsuppSession],
  ], async () => {
    await assert.rejects(
      academicYearService.establishCurrentAcademicYear(VALID_ID, actor),
      error => error.statusCode === 503 && /transaction support/.test(error.message)
    );
  });
});
