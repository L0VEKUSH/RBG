'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const Student = require('../models/Student');
const User = require('../models/User');
const AcademicYear = require('../models/AcademicYear');
const RolloverExecution = require('../models/RolloverExecution');
const AuditLog = require('../models/AuditLog');
const rolloverService = require('../services/rollover.service');
const { requirePermission } = require('../middleware/authorization.middleware');
const { schoolDayBounds, nextSchoolDate, schoolDateKey } = require('../utils/attendance-date');

const SOURCE = '2026-2027';
const DESTINATION = '2027-2028';
const ACTOR = '64f0000000000000000000ff';
const STUDENT_ONE = '64f000000000000000000001';
const STUDENT_TWO = '64f000000000000000000002';

function makeQuery(value) {
  return {
    session() { return this; },
    select() { return this; },
    sort() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function year(name, current) {
  const startKey = `${name.slice(0, 4)}-04-01`;
  const endKey = `${name.slice(5)}-03-31`;
  return {
    name,
    startDate: schoolDayBounds(startKey).start,
    endDate: schoolDayBounds(endKey).start,
    isActive: true,
    isCurrent: current,
    save: async function() { return this; },
  };
}

function student(id, overrides = {}) {
  return {
    _id: id,
    user: `${id.slice(0, -1)}3`,
    class: '5',
    academicYear: SOURCE,
    isActive: true,
    tcIssued: false,
    academicStatus: 'enrolled',
    enrollmentEffectiveFrom: schoolDayBounds('2026-04-01').start,
    enrollmentHistory: [],
    rollNumber: 1,
    stream: 'N/A',
    ...overrides,
    save: async function() { return this; },
  };
}

async function harness({ students = [student(STUDENT_ONE)], transactionUnsupported = false } = {}, callback) {
  const source = year(SOURCE, true);
  const destination = year(DESTINATION, false);
  const records = new Map(students.map(item => [String(item._id), item]));
  const rollover = {
    _id: '74f000000000000000000001',
    sourceAcademicYear: SOURCE,
    destinationAcademicYear: DESTINATION,
    status: 'draft',
    revision: 0,
    decisions: students.map(item => ({
      student: item._id,
      action: 'pending',
      currentClass: item.class,
      currentAcademicYear: item.academicYear,
      currentIsActive: item.isActive !== false,
      currentTcIssued: item.tcIssued === true,
      result: 'pending',
    })),
    save: async function() { return this; },
  };
  const calls = { writes: [], audits: 0, transactions: 0, sessions: 0 };
  const originals = {
    academicFindOne: AcademicYear.findOne,
    studentFind: Student.find,
    studentFindOne: Student.findOne,
    rolloverCreate: RolloverExecution.create,
    rolloverFindById: RolloverExecution.findById,
    rolloverFindOneAndUpdate: RolloverExecution.findOneAndUpdate,
    userUpdateOne: User.updateOne,
    auditCreate: AuditLog.create,
    startSession: mongoose.startSession,
  };
  AcademicYear.findOne = filter => makeQuery(filter.name === SOURCE ? source : destination);
  Student.find = () => makeQuery(Array.from(records.values()));
  Student.findOne = filter => {
    const item = records.get(String(filter._id));
    const activeMatches = filter.isActive === false
      ? item && item.isActive === false
      : item && item.isActive !== false;
    const tcMatches = filter.tcIssued === true
      ? item && item.tcIssued === true
      : item && item.tcIssued !== true;
    if (!item || item.academicYear !== filter.academicYear || item.class !== filter.class ||
        !activeMatches || !tcMatches) return makeQuery(null);
    return makeQuery(item);
  };
  RolloverExecution.create = async value => {
    Object.assign(rollover, value);
    return rollover;
  };
  RolloverExecution.findById = async () => rollover;
  RolloverExecution.findOneAndUpdate = async (filter, update) => {
    if (filter._id && String(filter._id) !== String(rollover._id)) return null;
    if (filter.status && rollover.status !== filter.status) return null;
    if (filter.revision !== undefined && rollover.revision !== filter.revision) return null;
    if (update.$set) {
      if (update.$set.status) rollover.status = update.$set.status;
      if (update.$set.executedBy) rollover.executedBy = update.$set.executedBy;
      if (update.$set.decisions) rollover.decisions = update.$set.decisions;
    }
    if (update.$inc) {
      if (update.$inc.revision) rollover.revision += update.$inc.revision;
    }
    return rollover;
  };
  User.updateOne = () => ({ session: async () => ({ acknowledged: true }) });
  AuditLog.create = async () => { calls.audits += 1; };
  mongoose.startSession = async () => {
    calls.sessions += 1;
    const session = {
      async withTransaction(work) {
        calls.transactions += 1;
        if (transactionUnsupported) {
          const error = new Error('Transactions are not supported on this deployment');
          error.code = 20;
          throw error;
        }
        return work();
      },
      async endSession() {},
    };
    for (const item of records.values()) {
      item.save = async ({ session } = {}) => {
        assert.equal(session, session);
        calls.writes.push(String(item._id));
        return item;
      };
    }
    return session;
  };
  try {
    return await callback({ source, destination, rollover, records, calls });
  } finally {
    AcademicYear.findOne = originals.academicFindOne;
    Student.find = originals.studentFind;
    Student.findOne = originals.studentFindOne;
    RolloverExecution.create = originals.rolloverCreate;
    RolloverExecution.findById = originals.rolloverFindById;
    RolloverExecution.findOneAndUpdate = originals.rolloverFindOneAndUpdate;
    User.updateOne = originals.userUpdateOne;
    AuditLog.create = originals.auditCreate;
    mongoose.startSession = originals.startSession;
  }
}

test('rollover drafts preserve pending decisions and refuse unresolved execution', async () => {
  await harness({}, async ({ rollover }) => {
    const draft = await rolloverService.createDraft({
      sourceAcademicYear: SOURCE, destinationAcademicYear: DESTINATION, actor: { _id: ACTOR },
    });
    assert.equal(draft.decisions[0].action, 'pending');
    await assert.rejects(
      rolloverService.execute(rollover._id, { _id: ACTOR }),
      error => error.statusCode === 409 && /explicit decision/.test(error.message)
    );
  });
});

test('rollover executes explicit promote and continue decisions with history', async () => {
  await harness({ students: [student(STUDENT_ONE), student(STUDENT_TWO)] }, async ({ rollover, records, calls }) => {
    await rolloverService.saveDecisions(rollover._id, {
      expectedRevision: 0,
      decisions: [
        { student: STUDENT_ONE, action: 'promote', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: true, currentTcIssued: false },
        { student: STUDENT_TWO, action: 'continue', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: true, currentTcIssued: false },
      ],
    }, { _id: ACTOR });
    await rolloverService.execute(rollover._id, { _id: ACTOR });
    assert.equal(records.get(STUDENT_ONE).class, '6');
    assert.equal(records.get(STUDENT_TWO).class, '5');
    assert.equal(records.get(STUDENT_ONE).academicYear, DESTINATION);
    assert.equal(records.get(STUDENT_TWO).academicYear, DESTINATION);
    assert.equal(records.get(STUDENT_ONE).enrollmentHistory.length, 1);
    assert.equal(records.get(STUDENT_TWO).enrollmentHistory.length, 1);
    assert.equal(calls.audits, 1);
    assert.equal(rollover.status, 'completed');
  });
});

test('rollover validates terminal, TC, and invalid promotion decisions', async () => {
  await harness({ students: [student(STUDENT_ONE, { class: '12' })] }, async ({ rollover }) => {
    await assert.rejects(
      rolloverService.saveDecisions(rollover._id, {
        expectedRevision: 0,
        decisions: [{ student: STUDENT_ONE, action: 'promote', currentClass: '12', currentAcademicYear: SOURCE, currentIsActive: true, currentTcIssued: false }],
      }, { _id: ACTOR }),
      error => error.statusCode === 400 && /Class 12/.test(error.message)
    );
    await rolloverService.saveDecisions(rollover._id, {
      expectedRevision: 0,
      decisions: [{ student: STUDENT_ONE, action: 'graduate', currentClass: '12', currentAcademicYear: SOURCE, currentIsActive: true, currentTcIssued: false, effectiveDate: '2027-03-31' }],
    }, { _id: ACTOR });
  });
  await harness({ students: [student(STUDENT_ONE, { tcIssued: true, isActive: false })] }, async ({ rollover }) => {
    await assert.rejects(
      rolloverService.saveDecisions(rollover._id, {
        expectedRevision: 0,
        decisions: [{ student: STUDENT_ONE, action: 'continue', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: false, currentTcIssued: true }],
      }, { _id: ACTOR }),
      error => error.statusCode === 409 && /TC-issued/.test(error.message)
    );
  });
});

test('rollover applies explicit graduate, withdraw, and transfer decisions', async () => {
  await harness({ students: [student(STUDENT_ONE, { class: '12' })] }, async ({ rollover, records }) => {
    await rolloverService.saveDecisions(rollover._id, {
      expectedRevision: 0,
      decisions: [{ student: STUDENT_ONE, action: 'graduate', currentClass: '12', currentAcademicYear: SOURCE, currentIsActive: true, currentTcIssued: false, effectiveDate: '2027-03-31' }],
    }, { _id: ACTOR });
    await rolloverService.execute(rollover._id, { _id: ACTOR });
    const updated = records.get(STUDENT_ONE);
    assert.equal(updated.academicStatus, 'graduated');
    assert.equal(updated.isActive, false);
    assert.equal(updated.academicYear, SOURCE);
    assert.equal(updated.enrollmentHistory.length, 1);
  });
  await harness({}, async ({ rollover, records }) => {
    await rolloverService.saveDecisions(rollover._id, {
      expectedRevision: 0,
      decisions: [{ student: STUDENT_ONE, action: 'withdraw', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: true, currentTcIssued: false, effectiveDate: '2027-03-31' }],
    }, { _id: ACTOR });
    await rolloverService.execute(rollover._id, { _id: ACTOR });
    assert.equal(records.get(STUDENT_ONE).academicStatus, 'withdrawn');
    assert.equal(records.get(STUDENT_ONE).isActive, false);
  });
  await harness({}, async ({ rollover, records }) => {
    await rolloverService.saveDecisions(rollover._id, {
      expectedRevision: 0,
      decisions: [{ student: STUDENT_ONE, action: 'transfer', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: true, currentTcIssued: false, effectiveDate: '2027-03-31' }],
    }, { _id: ACTOR });
    await rolloverService.execute(rollover._id, { _id: ACTOR });
    const transferred = records.get(STUDENT_ONE);
    assert.equal(transferred.academicStatus, 'transferred');
    assert.equal(transferred.tcIssued, true);
    assert.equal(transferred.isActive, false);
    assert.ok(transferred.tcDate instanceof Date);
    assert.equal(transferred.tcLastEnrolledDate.toISOString(), schoolDayBounds('2027-03-31').start.toISOString());
    // Exclusive boundary check: next school date boundary closes history segment
    assert.equal(transferred.enrollmentHistory[0].promotedDate.toISOString(), schoolDayBounds(nextSchoolDate('2027-03-31')).start.toISOString());
  });
});

test('inactive and TC-issued students can receive explicit leave_unchanged decision without deadlock', async () => {
  const inactiveStudent = student(STUDENT_ONE, { isActive: false, tcIssued: false, academicStatus: 'withdrawn' });
  const tcStudent = student(STUDENT_TWO, { isActive: false, tcIssued: true, academicStatus: 'transferred' });
  await harness({ students: [inactiveStudent, tcStudent] }, async ({ rollover, records }) => {
    // Attempting normal actions remains rejected
    await assert.rejects(
      rolloverService.saveDecisions(rollover._id, {
        expectedRevision: 0,
        decisions: [{ student: STUDENT_ONE, action: 'promote', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: false, currentTcIssued: false }],
      }, { _id: ACTOR }),
      error => error.statusCode === 409 && /Inactive or TC-issued/.test(error.message)
    );
    // Explicit leave_unchanged succeeds
    await rolloverService.saveDecisions(rollover._id, {
      expectedRevision: 0,
      decisions: [
        { student: STUDENT_ONE, action: 'leave_unchanged', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: false, currentTcIssued: false },
        { student: STUDENT_TWO, action: 'leave_unchanged', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: false, currentTcIssued: true },
      ],
    }, { _id: ACTOR });
    // Execution succeeds without deadlock
    await rolloverService.execute(rollover._id, { _id: ACTOR });
    assert.equal(rollover.status, 'completed');
    assert.equal(records.get(STUDENT_ONE).isActive, false);
    assert.equal(records.get(STUDENT_ONE).academicYear, SOURCE);
    assert.equal(records.get(STUDENT_TWO).tcIssued, true);
    assert.equal(records.get(STUDENT_TWO).isActive, false);
    assert.equal(records.get(STUDENT_TWO).academicYear, SOURCE);
    assert.equal(records.get(STUDENT_ONE).enrollmentHistory.length, 0);
    assert.equal(records.get(STUDENT_TWO).enrollmentHistory.length, 0);
  });
});

test('transfer effective date validates academic year bounds and enrollment start', async () => {
  await harness({}, async ({ rollover }) => {
    // Effective date before source academic year start
    await assert.rejects(
      rolloverService.saveDecisions(rollover._id, {
        expectedRevision: 0,
        decisions: [{ student: STUDENT_ONE, action: 'transfer', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: true, currentTcIssued: false, effectiveDate: '2026-03-31' }],
      }, { _id: ACTOR }),
      error => error.statusCode === 400 && /source academic year/.test(error.message)
    );
    // Effective date after source academic year end
    await assert.rejects(
      rolloverService.saveDecisions(rollover._id, {
        expectedRevision: 0,
        decisions: [{ student: STUDENT_ONE, action: 'transfer', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: true, currentTcIssued: false, effectiveDate: '2027-04-05' }],
      }, { _id: ACTOR }),
      error => error.statusCode === 400 && /source academic year/.test(error.message)
    );
  });
  // Effective date before student enrollment start
  const midYearStudent = student(STUDENT_ONE, { enrollmentEffectiveFrom: schoolDayBounds('2026-09-01').start });
  await harness({ students: [midYearStudent] }, async ({ rollover }) => {
    await rolloverService.saveDecisions(rollover._id, {
      expectedRevision: 0,
      decisions: [{ student: STUDENT_ONE, action: 'transfer', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: true, currentTcIssued: false, effectiveDate: '2026-06-01' }],
    }, { _id: ACTOR });
    await assert.rejects(
      rolloverService.execute(rollover._id, { _id: ACTOR }),
      error => error.statusCode === 400 && /cannot precede the student current enrollment date/.test(error.message)
    );
  });
});

test('atomic revision check requires valid expectedRevision and prevents concurrent overwrites', async () => {
  await harness({}, async ({ rollover }) => {
    // Missing expectedRevision is rejected
    await assert.rejects(
      rolloverService.saveDecisions(rollover._id, { decisions: [] }, { _id: ACTOR }),
      error => error.statusCode === 400 && /expectedRevision/.test(error.message)
    );
    // Negative expectedRevision is rejected
    await assert.rejects(
      rolloverService.saveDecisions(rollover._id, { expectedRevision: -1, decisions: [] }, { _id: ACTOR }),
      error => error.statusCode === 400 && /expectedRevision/.test(error.message)
    );
    // Stale revision is rejected by in-memory check
    rollover.revision = 3;
    await assert.rejects(
      rolloverService.saveDecisions(rollover._id, { expectedRevision: 2, decisions: [] }, { _id: ACTOR }),
      error => error.statusCode === 409 && /changed since it was loaded/.test(error.message)
    );
  });

  // Simulated concurrent saves: only first succeeds, second gets 409
  await harness({}, async ({ rollover }) => {
    const save1Promise = rolloverService.saveDecisions(rollover._id, {
      expectedRevision: 0,
      decisions: [{ student: STUDENT_ONE, action: 'continue', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: true, currentTcIssued: false }],
    }, { _id: ACTOR });

    await save1Promise;
    assert.equal(rollover.revision, 1);

    // Second writer using stale revision 0 fails with 409
    await assert.rejects(
      rolloverService.saveDecisions(rollover._id, {
        expectedRevision: 0,
        decisions: [{ student: STUDENT_ONE, action: 'promote', currentClass: '5', currentAcademicYear: SOURCE, currentIsActive: true, currentTcIssued: false }],
      }, { _id: ACTOR }),
      error => error.statusCode === 409
    );
  });

  // Saving against executing or completed rollover is rejected
  await harness({}, async ({ rollover }) => {
    rollover.status = 'executing';
    await assert.rejects(
      rolloverService.saveDecisions(rollover._id, { expectedRevision: 0, decisions: [] }, { _id: ACTOR }),
      error => error.statusCode === 409 && /draft/.test(error.message)
    );
    rollover.status = 'completed';
    await assert.rejects(
      rolloverService.saveDecisions(rollover._id, { expectedRevision: 0, decisions: [] }, { _id: ACTOR }),
      error => error.statusCode === 409 && /draft/.test(error.message)
    );
  });
});

test('duplicate execution and unavailable transactions fail closed', async () => {
  await harness({}, async ({ rollover }) => {
    rollover.status = 'completed';
    await assert.rejects(
      rolloverService.execute(rollover._id, { _id: ACTOR }),
      error => error.statusCode === 409 && /already been completed/.test(error.message)
    );
  });
  await harness({ transactionUnsupported: true }, async ({ rollover, records, calls }) => {
    rollover.decisions[0].action = 'continue';
    await assert.rejects(
      rolloverService.execute(rollover._id, { _id: ACTOR }),
      error => error.statusCode === 503 && /No students/.test(error.message)
    );
    assert.equal(calls.writes.length, 0);
    assert.equal(records.get(STUDENT_ONE).academicYear, SOURCE);
  });
});

test('rollover routes require academic-year management permission', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'rollover.routes.js'), 'utf8');
  assert.match(source, /requirePermission\('academic-years\.manage'\)/);
  let forwarded;
  requirePermission('academic-years.manage')(
    { user: { role: 'teacher', permissions: [] } }, {}, error => { forwarded = error; }
  );
  assert.equal(forwarded.statusCode, 403);
});
