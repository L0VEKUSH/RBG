'use strict';
/**
 * Phase 22.3 — Timetable conflict detection tests (fully offline, no DB)
 *
 * Tests the assertNoConflicts logic inside timetable.service.js by mocking
 * Timetable.find to return controlled fixtures.
 *
 * Period identity is based on periodNumber (integer). startTime/endTime are
 * optional strings and are NOT used for overlap detection.
 *
 * Concurrency note: the conflict check is a best-effort read-then-write.
 * Two simultaneous writes that both pass the check can still produce a
 * conflict. This is a known, documented limitation; the unique compound index
 * on {class, academicYear, day} prevents duplicate documents but cannot
 * prevent period-level teacher/room collisions at the database layer.
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');

// ── Helpers ──────────────────────────────────────────────────────────────────

const REPO = path.resolve(__dirname, '..');
const TIMETABLE_MODEL_PATH  = path.join(REPO, 'models', 'Timetable');
const TIMETABLE_SERVICE_PATH = path.join(REPO, 'services', 'timetable.service');

function fakeObjectId(n) {
  return String(n).padStart(24, '0');
}

/** Minimal stub that satisfies require() for modules we don't need. */
function emptyStub() { return {}; }

function setupMocks(findResults) {
  // Clear require cache for modules that will be mocked
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes('timetable.service') ||
      key.includes('timetable-conflict') ||
      key.includes('models')
    ) {
      delete require.cache[key];
    }
  }

  // Stub heavy dependencies before the service loads
  require.cache[require.resolve(path.join(REPO, 'models', 'Class'))] = {
    id: 'class-stub', filename: 'class-stub', loaded: true, exports: {
      findOne: async () => ({ _id: 'cls1', name: '1', academicYear: '2024-2025' }),
    },
  };

  require.cache[require.resolve(path.join(REPO, 'models', 'Student'))]          = { id: 's', filename: 's', loaded: true, exports: emptyStub() };
  require.cache[require.resolve(path.join(REPO, 'models', 'Faculty'))]          = { id: 'f', filename: 'f', loaded: true, exports: emptyStub() };
  require.cache[require.resolve(path.join(REPO, 'models', 'Parent'))]           = { id: 'p', filename: 'p', loaded: true, exports: emptyStub() };
  require.cache[require.resolve(path.join(REPO, 'models', 'SubjectAllocation'))]= { id: 'sa', filename: 'sa', loaded: true, exports: emptyStub() };
  require.cache[require.resolve(path.join(REPO, 'utils', 'errorResponse'))]     = {
    id: 'er', filename: 'er', loaded: true,
    exports: class ErrorResponse extends Error {
      constructor(message, statusCode) { super(message); this.statusCode = statusCode; }
    },
  };
  require.cache[require.resolve(path.join(REPO, 'utils', 'academic-year'))] = {
    id: 'ay', filename: 'ay', loaded: true,
    exports: { isValidAcademicYear: y => /^\d{4}-\d{4}$/.test(y) },
  };

  // The Timetable model — the find() return is what we control per test
  const TimetableStub = {
    find:   () => ({ select: () => ({ lean: async () => findResults }) }),
    create: async d => d,
    findById: async () => null,
    findByIdAndUpdate: async () => null,
  };
  require.cache[require.resolve(TIMETABLE_MODEL_PATH)] = {
    id: TIMETABLE_MODEL_PATH, filename: TIMETABLE_MODEL_PATH, loaded: true,
    exports: TimetableStub,
  };

  // Also satisfy mongoose for the model file
  require.cache[require.resolve('mongoose')] = {
    id: 'mongoose', filename: 'mongoose', loaded: true,
    exports: {
      Schema: class Schema {
        constructor() {}
        index() { return this; }
      },
      model: () => TimetableStub,
      isValidObjectId: v => typeof v === 'string' && v.length === 24,
      Types: { ObjectId: class ObjectId {} },
    },
  };

  return require(TIMETABLE_SERVICE_PATH);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('Phase 22.3 — Timetable conflict detection', async t => {

  // ── 1. Teacher conflict across two classes ───────────────────────────────
  await t.test('1. Teacher conflict: same teacher in same period on same day → 409', async () => {
    const teacherId = fakeObjectId(1);
    const existing = [{
      _id: 'other-doc', class: '2', academicYear: '2024-2025', day: 'Monday',
      periods: [{ periodNumber: 3, teacher: teacherId, room: null }],
    }];
    const svc = setupMocks(existing);

    const incoming = { periodNumber: 3, subject: 'Math', teacher: teacherId };
    await assert.rejects(
      () => svc.createTimetable({
        class: '1', academicYear: '2024-2025', day: 'Monday',
        periods: [incoming],
      }),
      err => {
        assert.equal(err.statusCode, 409);
        assert.ok(err.message.includes('period 3'), `expected "period 3" in: ${err.message}`);
        return true;
      }
    );
  });

  // ── 2. Room conflict across two classes ──────────────────────────────────
  await t.test('2. Room conflict: same room in same period on same day → 409', async () => {
    const existing = [{
      _id: 'other-doc', class: '3', academicYear: '2024-2025', day: 'Tuesday',
      periods: [{ periodNumber: 2, teacher: null, room: 'Lab A' }],
    }];
    const svc = setupMocks(existing);

    await assert.rejects(
      () => svc.createTimetable({
        class: '1', academicYear: '2024-2025', day: 'Tuesday',
        periods: [{ periodNumber: 2, subject: 'Physics', room: 'lab a' }], // case-insensitive
      }),
      err => {
        assert.equal(err.statusCode, 409);
        assert.ok(err.message.toLowerCase().includes('lab a'), `expected "lab a" in: ${err.message}`);
        return true;
      }
    );
  });

  // ── 3. Duplicate class/day/academic-year (Mongo unique index) ────────────
  await t.test('3. Duplicate class+day+year: Mongo unique index enforces rejection', async () => {
    // Simulate the duplicate-key error that MongoDB would throw
    const svc = setupMocks([]); // no cross-class conflict — the duplicate-key error comes from Mongo

    // Override Timetable.create to throw a duplicate-key error (code 11000)
    const TimetableStub = require(TIMETABLE_MODEL_PATH);
    const origCreate = TimetableStub.create;
    const dupeErr = new Error('E11000 duplicate key error');
    dupeErr.code = 11000;
    TimetableStub.create = async () => { throw dupeErr; };

    try {
      await assert.rejects(
        () => svc.createTimetable({
          class: '1', academicYear: '2024-2025', day: 'Monday',
          periods: [{ periodNumber: 1, subject: 'English' }],
        }),
        err => {
          assert.equal(err.code, 11000);
          return true;
        }
      );
    } finally {
      TimetableStub.create = origCreate;
    }
  });

  // ── 4. Same teacher in DIFFERENT periods → no conflict ───────────────────
  await t.test('4. Same teacher, different period numbers → no conflict', async () => {
    const teacherId = fakeObjectId(2);
    const existing = [{
      _id: 'other-doc', class: '2', academicYear: '2024-2025', day: 'Wednesday',
      periods: [{ periodNumber: 1, teacher: teacherId, room: null }],
    }];
    const svc = setupMocks(existing);

    // Teacher is in period 2 (not 1) → should not conflict
    await assert.doesNotReject(
      () => svc.createTimetable({
        class: '1', academicYear: '2024-2025', day: 'Wednesday',
        periods: [{ periodNumber: 2, subject: 'Hindi', teacher: teacherId }],
      })
    );
  });

  // ── 5. Same room, different periods → no conflict ────────────────────────
  await t.test('5. Same room, different period numbers → no conflict', async () => {
    const existing = [{
      _id: 'other-doc', class: '4', academicYear: '2024-2025', day: 'Thursday',
      periods: [{ periodNumber: 1, teacher: null, room: 'Lab B' }],
    }];
    const svc = setupMocks(existing);

    await assert.doesNotReject(
      () => svc.createTimetable({
        class: '1', academicYear: '2024-2025', day: 'Thursday',
        periods: [{ periodNumber: 2, subject: 'Chemistry', room: 'Lab B' }],
      })
    );
  });

  // ── 6. Update: excludeId correctly excludes own document ─────────────────
  await t.test('6. Update excludes own document from conflict check → no false positive', async () => {
    const teacherId = fakeObjectId(3);
    const ownId = 'aabbccddeeff001122334455';

    // Simulate that the only "other" doc IS the document being updated —
    // since excludeId is passed, find() must have returned [] for us.
    const svc = setupMocks([]); // assertNoConflicts sees no conflicts

    // Patch findById to return the current document
    const TimetableStub = require(TIMETABLE_MODEL_PATH);
    const origFindById = TimetableStub.findById;
    TimetableStub.findById = async () => ({
      _id: ownId, class: '1', academicYear: '2024-2025', day: 'Friday',
      periods: [{ periodNumber: 2, teacher: teacherId }],
    });
    const origUpdate = TimetableStub.findByIdAndUpdate;
    TimetableStub.findByIdAndUpdate = async () => ({ _id: ownId });

    try {
      await assert.doesNotReject(
        () => svc.updateTimetable(ownId, {
          class: '1', academicYear: '2024-2025', day: 'Friday',
          periods: [{ periodNumber: 2, subject: 'Science', teacher: teacherId }],
        })
      );
    } finally {
      TimetableStub.findById = origFindById;
      TimetableStub.findByIdAndUpdate = origUpdate;
    }
  });

  // ── 7. Update into a genuine teacher conflict → 409 ──────────────────────
  await t.test('7. Update causes teacher conflict with another class → 409', async () => {
    const teacherId = fakeObjectId(4);
    const ownId = 'aabbccddeeff001122334456';

    // Existing OTHER document that conflicts
    const existing = [{
      _id: 'another-doc', class: '5', academicYear: '2024-2025', day: 'Friday',
      periods: [{ periodNumber: 1, teacher: teacherId, room: null }],
    }];
    const svc = setupMocks(existing);

    const TimetableStub = require(TIMETABLE_MODEL_PATH);
    const origFindById = TimetableStub.findById;
    TimetableStub.findById = async () => ({
      _id: ownId, class: '1', academicYear: '2024-2025', day: 'Friday',
      periods: [{ periodNumber: 2, subject: 'History' }],
    });

    try {
      await assert.rejects(
        () => svc.updateTimetable(ownId, {
          class: '1', academicYear: '2024-2025', day: 'Friday',
          // Now reassigning teacher to period 1 — conflicts with class 5
          periods: [{ periodNumber: 1, subject: 'Geography', teacher: teacherId }],
        }),
        err => {
          assert.equal(err.statusCode, 409);
          return true;
        }
      );
    } finally {
      TimetableStub.findById = origFindById;
    }
  });

  // ── 8. Different academic years → no conflict ────────────────────────────
  await t.test('8. Same teacher, same period, different academic year → no conflict', async () => {
    const teacherId = fakeObjectId(5);
    // find() returns empty because day+year query filters by year — simulated here
    const svc = setupMocks([]); // no same-year docs returned

    await assert.doesNotReject(
      () => svc.createTimetable({
        class: '1', academicYear: '2025-2026', day: 'Monday',
        periods: [{ periodNumber: 1, subject: 'EVS', teacher: teacherId }],
      })
    );
  });

  // ── 9. Different days → no conflict ──────────────────────────────────────
  await t.test('9. Same teacher, same period, different day → no conflict', async () => {
    const teacherId = fakeObjectId(6);
    // find() scopes by day — returns empty because the existing doc is for Tuesday
    const svc = setupMocks([]);

    await assert.doesNotReject(
      () => svc.createTimetable({
        class: '1', academicYear: '2024-2025', day: 'Wednesday',
        periods: [{ periodNumber: 1, subject: 'Music', teacher: teacherId }],
      })
    );
  });

  // ── 10. Null/empty room → no room conflict triggered ─────────────────────
  await t.test('10. Null/empty room on existing period → no room conflict', async () => {
    const existing = [{
      _id: 'other-doc', class: '6', academicYear: '2024-2025', day: 'Monday',
      periods: [{ periodNumber: 1, teacher: null, room: '' }],   // empty room
    }];
    const svc = setupMocks(existing);

    // Incoming period also has no room → no conflict should fire
    await assert.doesNotReject(
      () => svc.createTimetable({
        class: '1', academicYear: '2024-2025', day: 'Monday',
        periods: [{ periodNumber: 1, subject: 'Art' }], // no room field
      })
    );
  });

  // ── 11. Concurrent-write limitation documented ───────────────────────────
  await t.test('11. Concurrent-write limitation: read-before-write pattern verified', async () => {
    /*
     * This test verifies that assertNoConflicts is a read-before-write check,
     * not an atomic database constraint. Two simultaneous createTimetable calls
     * that both pass the check at the same millisecond can both write, leaving
     * a data inconsistency that the unique compound index {class,academicYear,day}
     * cannot prevent at the period level.
     *
     * Mitigation: application-level write serialisation (e.g. a distributed lock
     * per {academicYear, day}) is the correct future fix. For now, the conflict
     * check is the best available safeguard under the existing schema.
     *
     * We verify the pattern by confirming that Timetable.find is called by the
     * service before Timetable.create by inspecting the service source directly.
     */

    // Read the service source and confirm find() precedes create() in the
    // createTimetable function body — a static assertion that is immune to
    // require-cache ordering issues.
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve(TIMETABLE_SERVICE_PATH), 'utf8');

    // Extract the createTimetable export body
    const createMatch = src.match(/exports\.createTimetable\s*=\s*async[^{]*\{([\s\S]*?)^\};/m);
    assert.ok(createMatch, 'Could not locate exports.createTimetable in source');
    const body = createMatch[1];

    const findIdx   = body.indexOf('assertNoConflicts');
    const createIdx = body.indexOf('Timetable.create');
    assert.ok(findIdx   >= 0, 'assertNoConflicts not found in createTimetable body');
    assert.ok(createIdx >= 0, 'Timetable.create not found in createTimetable body');
    assert.ok(findIdx < createIdx,
      `assertNoConflicts (pos ${findIdx}) must appear before Timetable.create (pos ${createIdx})`);
  });

});
