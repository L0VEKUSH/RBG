'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const Student = require('../models/Student');
const AcademicYear = require('../models/AcademicYear');
const AuditLog = require('../models/AuditLog');
const studentService = require('../services/student.service');
const studentController = require('../controllers/student.controller');
const { requirePermission } = require('../middleware/authorization.middleware');

// The in-memory session harness below verifies service session propagation and modeled aborts only.
// It does not connect to MongoDB or verify transaction behavior on a real replica set.
const SOURCE_YEAR = '2026-2027';
const TARGET_YEAR = '2027-2028';
const ACTOR_ID = '64f0000000000000000000ff';
const STUDENT_ONE = '64f000000000000000000001';
const STUDENT_TWO = '64f000000000000000000002';

function targetAcademicYear() {
  return {
    name: TARGET_YEAR,
    startDate: new Date('2027-04-01T00:00:00.000Z'),
    endDate: new Date('2028-03-31T23:59:59.999Z'),
    isActive: true,
  };
}

function makeStudent(id, overrides = {}) {
  return {
    _id: id,
    class: '5',
    academicYear: SOURCE_YEAR,
    isActive: true,
    enrollmentHistory: [],
    enrollmentEffectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    stream: 'N/A',
    rollNumber: 1,
    ...overrides,
  };
}

function makeQuery(value, calls, label) {
  return {
    session(session) {
      calls.sessionReads.push({ label, session });
      return this;
    },
    select() {
      return Promise.resolve(value);
    },
  };
}

async function withPromotionHarness(options, callback) {
  const calls = { sessionReads: [], writes: [], audits: [], transactions: 0, sessionEnds: 0 };
  const students = new Map((options.students || []).map(student => [String(student._id).toLowerCase(), student]));
  const state = { students, audits: [] };
  const originals = {
    studentFind: Student.find,
    academicYearFindOne: AcademicYear.findOne,
    academicYearFind: AcademicYear.find,
    auditCreate: AuditLog.create,
    startSession: mongoose.startSession,
  };

  Student.find = filter => {
    calls.studentFilter = filter;
    const requested = new Set(filter._id.$in.map(id => String(id).toLowerCase()));
    const docs = Array.from(state.students.entries())
      .filter(([id, student]) => requested.has(id) && student.isActive !== false)
      .map(([, student]) => student);
    return makeQuery(docs, calls, 'Student.find');
  };
  AcademicYear.findOne = filter => {
    calls.targetYearFilter = filter;
    const year = options.missingTargetYear ? null : (options.targetYear || targetAcademicYear());
    return makeQuery(year, calls, 'AcademicYear.findOne');
  };
  AcademicYear.find = filter => {
    calls.academicYearFilter = filter;
    const years = options.activeYears || [options.targetYear || targetAcademicYear()];
    return makeQuery(years, calls, 'AcademicYear.find');
  };
  AuditLog.create = async (records, writeOptions) => {
    calls.audits.push({ records, writeOptions });
    if (!writeOptions || !writeOptions.session) throw new Error('Audit write omitted transaction session');
    if (options.failAudit) throw new Error('synthetic audit persistence failure');
    state.audits.push(...records);
    return records;
  };
  mongoose.startSession = async () => {
    const session = {
      async withTransaction(work, transactionOptions) {
        calls.transactions++;
        calls.transactionOptions = transactionOptions;
        if (options.transactionUnsupported) {
          const error = new Error('Transactions are not supported on this deployment');
          error.code = 20;
          throw error;
        }
        const snapshot = new Map(Array.from(state.students.entries()).map(([id, student]) => [
          id,
          { ...student, enrollmentHistory: Array.isArray(student.enrollmentHistory) ? student.enrollmentHistory.slice() : [] },
        ]));
        const auditSnapshot = state.audits.slice();
        try {
          return await work();
        } catch (error) {
          state.students.clear();
          snapshot.forEach((student, id) => state.students.set(id, student));
          state.audits = auditSnapshot;
          throw error;
        }
      },
      async endSession() { calls.sessionEnds++; },
    };
    calls.session = session;
    for (const [id, student] of state.students) {
      student.save = async function(saveOptions) {
        assert.equal(saveOptions.session, session, 'each student save must use the batch session');
        calls.writes.push(id);
        if (options.failStudentId && id === options.failStudentId.toLowerCase()) {
          throw new Error('synthetic student persistence failure');
        }
        state.students.set(id, {
          ...this,
          enrollmentHistory: this.enrollmentHistory.slice(),
          save: this.save,
        });
        return this;
      };
    }
    return session;
  };

  const promote = (ids, overrides = {}) => studentService.promoteStudents(
    ids,
    overrides.newClass,
    overrides.newAcademicYear || TARGET_YEAR,
    {
      sourceAcademicYear: overrides.sourceAcademicYear || SOURCE_YEAR,
      sourceClass: overrides.sourceClass === undefined ? '5' : overrides.sourceClass,
      actor: { _id: ACTOR_ID },
      auditContext: { ipAddress: '127.0.0.1', userAgent: 'promotion-test' },
    }
  );

  try {
    return await callback({ calls, state, promote });
  } finally {
    Student.find = originals.studentFind;
    AcademicYear.findOne = originals.academicYearFindOne;
    AcademicYear.find = originals.academicYearFind;
    AuditLog.create = originals.auditCreate;
    mongoose.startSession = originals.startSession;
  }
}

test('promotion rejects invalid ObjectIds before starting a transaction', async () => {
  await withPromotionHarness({}, async ({ calls, promote }) => {
    await assert.rejects(promote(['not-an-object-id']), error => error.statusCode === 400 && /ObjectId/.test(error.message));
    assert.equal(calls.transactions, 0);
  });
});

test('promotion rejects duplicate student IDs before starting a transaction', async () => {
  await withPromotionHarness({}, async ({ calls, promote }) => {
    await assert.rejects(promote([STUDENT_ONE, STUDENT_ONE.toUpperCase()]), error => error.statusCode === 400 && /duplicate/.test(error.message));
    assert.equal(calls.transactions, 0);
  });
});

test('promotion rejects a missing student instead of silently skipping it', async () => {
  await withPromotionHarness({}, async ({ calls, promote }) => {
    await assert.rejects(promote([STUDENT_ONE]), error => error.statusCode === 404 && /not found or inactive/.test(error.message));
    assert.equal(calls.writes.length, 0);
  });
});

test('Class 12 direct promotion submissions are rejected', async () => {
  await withPromotionHarness({}, async ({ calls, promote }) => {
    await assert.rejects(promote([STUDENT_ONE], { sourceClass: '12' }), error => error.statusCode === 400 && /cannot be automatically promoted/.test(error.message));
    assert.equal(calls.transactions, 0);
  });
});

test('Pre-Nursery direct promotion submissions are rejected', async () => {
  await withPromotionHarness({}, async ({ calls, promote }) => {
    await assert.rejects(promote([STUDENT_ONE], { sourceClass: 'Pre-Nursery' }), error => error.statusCode === 400 && /not an approved school class/.test(error.message));
    assert.equal(calls.transactions, 0);
  });
});

test('Class 11 students can be promoted to Class 12 by the bulk promotion API', async () => {
  await withPromotionHarness({
    students: [
      makeStudent(STUDENT_ONE, {
        class: '11',
        academicYear: SOURCE_YEAR,
      }),
    ],
  }, async ({ calls, state, promote }) => {
    const results = await promote([STUDENT_ONE], { sourceClass: '11' });
    assert.equal(results.length, 1);
    const updated = state.students.get(STUDENT_ONE);
    assert.equal(updated.class, '12');
    assert.equal(updated.academicYear, TARGET_YEAR);
    assert.equal(updated.enrollmentHistory.length, 1);
    assert.equal(updated.enrollmentHistory[0].class, '11');
    assert.equal(calls.transactions, 1);
  });
});

test('Class 10 students can be promoted to Class 11 by the bulk promotion API', async () => {
  await withPromotionHarness({
    students: [
      makeStudent(STUDENT_ONE, {
        class: '10',
        academicYear: SOURCE_YEAR,
      }),
    ],
  }, async ({ calls, state, promote }) => {
    const results = await promote([STUDENT_ONE], { sourceClass: '10' });
    assert.equal(results.length, 1);
    const updated = state.students.get(STUDENT_ONE);
    assert.equal(updated.class, '11');
    assert.equal(updated.academicYear, TARGET_YEAR);
    assert.equal(updated.enrollmentHistory.length, 1);
    assert.equal(updated.enrollmentHistory[0].class, '10');
    assert.equal(calls.transactions, 1);
  });
});

test('promotion rejects a request that explicitly assigns Class 12', async () => {
  await withPromotionHarness({}, async ({ calls, promote }) => {
    await assert.rejects(promote([STUDENT_ONE], { newClass: '12' }), error => error.statusCode === 400 && /canonical next class/.test(error.message));
    assert.equal(calls.transactions, 0);
  });
});

test('promotion rejects a student whose stored current class is not canonical', async () => {
  await withPromotionHarness({ students: [makeStudent(STUDENT_ONE, { class: 'Class Five' })] }, async ({ calls, promote }) => {
    await assert.rejects(promote([STUDENT_ONE]), error => error.statusCode === 400 && /invalid current class/.test(error.message));
    assert.equal(calls.writes.length, 0);
  });
});

test('promotion rejects a source academic-year mismatch', async () => {
  await withPromotionHarness({ students: [makeStudent(STUDENT_ONE, { academicYear: '2025-2026' })] }, async ({ calls, promote }) => {
    await assert.rejects(promote([STUDENT_ONE]), error => error.statusCode === 400 && /belongs to academic year/.test(error.message));
    assert.equal(calls.writes.length, 0);
  });
});

test('promotion rejects a batch mixing academic years before writing any student', async () => {
  await withPromotionHarness({ students: [
    makeStudent(STUDENT_ONE),
    makeStudent(STUDENT_TWO, { academicYear: '2025-2026' }),
  ] }, async ({ calls, promote }) => {
    await assert.rejects(promote([STUDENT_ONE, STUDENT_TWO]), error => error.statusCode === 400 && /belongs to academic year/.test(error.message));
    assert.equal(calls.writes.length, 0);
  });
});

test('promotion rejects a non-consecutive target academic year before a transaction', async () => {
  await withPromotionHarness({}, async ({ calls, promote }) => {
    await assert.rejects(promote([STUDENT_ONE], { newAcademicYear: '2028-2029' }), error => error.statusCode === 400 && /exactly one year/.test(error.message));
    assert.equal(calls.transactions, 0);
  });
});

test('promotion rejects a missing target academic year', async () => {
  await withPromotionHarness({ missingTargetYear: true }, async ({ calls, promote }) => {
    await assert.rejects(promote([STUDENT_ONE]), error => error.statusCode === 404 && /Target academic year/.test(error.message));
    assert.equal(calls.writes.length, 0);
  });
});

test('promotion rejects effective dates that overlap configured academic years', async () => {
  const overlappingYear = {
    name: '2026-2027',
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2027-04-05T23:59:59.999Z'),
    isActive: true,
  };
  await withPromotionHarness({
    students: [makeStudent(STUDENT_ONE)],
    activeYears: [targetAcademicYear(), overlappingYear],
  }, async ({ calls, promote }) => {
    await assert.rejects(promote([STUDENT_ONE]), error => error.statusCode === 409 && /overlapping academic years/.test(error.message));
    assert.equal(calls.writes.length, 0);
  });
});

test('promotion rejects a target academic-year start date outside its configured date boundaries', async () => {
  const invalidTarget = targetAcademicYear();
  invalidTarget.endDate = new Date('2027-03-31T00:00:00.000Z');
  await withPromotionHarness({
    students: [makeStudent(STUDENT_ONE)],
    targetYear: invalidTarget,
  }, async ({ calls, promote }) => {
    await assert.rejects(promote([STUDENT_ONE]), error => error.statusCode === 409 && /invalid date boundaries/.test(error.message));
    assert.equal(calls.writes.length, 0);
  });
});

test('promotion rolls back all student writes when any member fails to persist', async () => {
  await withPromotionHarness({
    students: [makeStudent(STUDENT_ONE), makeStudent(STUDENT_TWO)],
    failStudentId: STUDENT_TWO,
  }, async ({ calls, state, promote }) => {
    await assert.rejects(promote([STUDENT_ONE, STUDENT_TWO]), error => error.statusCode === 500 && /No students were promoted/.test(error.message));
    assert.equal(state.students.get(STUDENT_ONE).class, '5');
    assert.equal(state.students.get(STUDENT_ONE).academicYear, SOURCE_YEAR);
    assert.equal(state.students.get(STUDENT_ONE).enrollmentHistory.length, 0);
    assert.equal(state.students.get(STUDENT_TWO).class, '5');
    assert.equal(state.audits.length, 0);
    assert.equal(calls.transactions, 1);
  });
});

test('promotion fails closed when MongoDB transaction support is unavailable', async () => {
  await withPromotionHarness({ students: [makeStudent(STUDENT_ONE)], transactionUnsupported: true }, async ({ calls, state, promote }) => {
    await assert.rejects(promote([STUDENT_ONE]), error => error.statusCode === 503 && /requires MongoDB transaction support/.test(error.message));
    assert.equal(state.students.get(STUDENT_ONE).class, '5');
    assert.equal(calls.writes.length, 0);
  });
});

test('unauthorized promotion requests are denied by the route permission middleware', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'student.routes.js'), 'utf8');
  assert.match(routeSource, /router\.post\('\/promote',\s*requirePermission\('students\.promote'\),\s*promoteStudents\)/);

  let forwardedError;
  requirePermission('students.promote')(
    { user: { _id: ACTOR_ID, role: 'student', permissions: [] } },
    {},
    error => { forwardedError = error; }
  );
  assert.equal(forwardedError.statusCode, 403);
  assert.match(forwardedError.message, /Permission denied/);
});

test('consecutive-year promotion returns all promoted students and writes one transactional audit record', async () => {
  await withPromotionHarness({ students: [makeStudent(STUDENT_ONE), makeStudent(STUDENT_TWO)] }, async ({ calls, state, promote }) => {
    const promoted = await promote([STUDENT_ONE, STUDENT_TWO]);
    assert.equal(promoted.length, 2);
    assert.deepEqual(promoted.map(student => student.class), ['6', '6']);
    assert.deepEqual(promoted.map(student => student.academicYear), [TARGET_YEAR, TARGET_YEAR]);
    assert.equal(state.audits.length, 1);
    assert.equal(state.audits[0].action, 'bulk_promotion');
    assert.equal(state.audits[0].details.promotedCount, 2);
    assert.equal(calls.audits[0].writeOptions.session, calls.session);
    assert.ok(calls.sessionReads.every(read => read.session === calls.session));
    assert.deepEqual(calls.transactionOptions, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    });
    assert.equal(calls.sessionEnds, 1);
  });
});

test('promotion controller returns one consistent success count and sanitizes unexpected failures', async () => {
  const original = studentService.promoteStudents;
  const response = () => ({
    statusCode: 0,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const req = {
    body: { studentIds: [STUDENT_ONE, STUDENT_TWO], sourceAcademicYear: SOURCE_YEAR, sourceClass: '5', newAcademicYear: TARGET_YEAR },
    user: { _id: ACTOR_ID },
    ip: '127.0.0.1',
    get: () => 'promotion-test',
  };
  let serviceCall;

  try {
    studentService.promoteStudents = async (...args) => {
      serviceCall = args;
      return [{ _id: STUDENT_ONE }, { _id: STUDENT_TWO }];
    };
    const success = response();
    await studentController.promoteStudents(req, success);
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.success, true);
    assert.equal(success.body.data.promotedCount, 2);
    assert.equal(success.body.data.students.length, 2);
    assert.deepEqual(serviceCall.slice(0, 3), [req.body.studentIds, undefined, TARGET_YEAR]);
    assert.equal(serviceCall[3].sourceAcademicYear, SOURCE_YEAR);
    assert.equal(serviceCall[3].sourceClass, '5');
    assert.equal(serviceCall[3].actor._id, ACTOR_ID);
    assert.equal(serviceCall[3].auditContext.userAgent, 'promotion-test');

    studentService.promoteStudents = async () => { throw new Error('sensitive MongoDB server detail'); };
    const failure = response();
    await studentController.promoteStudents(req, failure);
    assert.equal(failure.statusCode, 500);
    assert.deepEqual(failure.body, { success: false, message: 'Promotion failed. No students were promoted.' });
    assert.doesNotMatch(JSON.stringify(failure.body), /sensitive|stack/i);
  } finally {
    studentService.promoteStudents = original;
  }
});
