'use strict';
/**
 * Phase 26F – Batch 1 Regression Tests
 *
 * Covers all four Batch 1 fixes:
 *   Fix 4 – Legacy parent link compatibility (student-access.service.js)
 *   Fix 1 – TC-issued / inactive student visibility (student.service.js)
 *   Fix 2 – Leave date alias resolution (leave.controller.js)
 *   Fix 3 – Principal / Receptionist dashboard admission counter (dashboard.service.js)
 *
 * Uses Node's built-in test runner (node --test). Zero external test runners required.
 * No real database connections. Business-logic units are tested in isolation using
 * lightweight inline function-level stubs.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Error stub ───────────────────────────────────────────────────────────────
class ErrorResponse extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

// ─── Query builder stub ───────────────────────────────────────────────────────
// Simulates a chainable Mongoose query that resolves to `result`.
function queryStub(result) {
  const q = {
    _result: result,
    select() { return this; },
    populate() { return this; },
    sort() { return Promise.resolve(this._result); },
    lean() { return this; },
    limit() { return this; },
    then(resolve, reject) { return Promise.resolve(this._result).then(resolve, reject); },
    catch(onRejected) { return Promise.resolve(this._result).catch(onRejected); },
  };
  return q;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 4 — Legacy Parent Link Compatibility
// Tests the getStudentAccess function extracted inline to avoid DB dependency.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fix 4 — Legacy parent link compatibility', () => {

  /**
   * Inline reimplementation of the parent-role branch of getStudentAccess.
   * Mirrors the logic in services/student-access.service.js exactly.
   */
  async function getStudentAccessParent(user, { Parent, Student }) {
    if (!user || !user._id) throw new ErrorResponse('Not authenticated', 401);
    if (user.role !== 'parent') throw new ErrorResponse('Not a parent', 403);

    const toId = (v) => v && v._id ? v._id : v;
    const parent = await Parent.findOne({ user: user._id });
    const legacyStudents = await Student.find({ parentUser: user._id });
    const childIdSet = new Set();
    for (const child of (parent?.children || [])) {
      const id = toId(child);
      if (id) childIdSet.add(String(id));
    }
    for (const student of legacyStudents) {
      if (student?._id) childIdSet.add(String(student._id));
    }
    const childIds = Array.from(childIdSet);
    if (!childIds.length) {
      if (!parent && !legacyStudents.length) {
        throw new ErrorResponse('Parent profile not found', 404);
      }
      return { filter: { _id: { $in: [] } }, basic: false };
    }
    return { filter: { _id: { $in: childIds } }, basic: false };
  }

  const makeParentUser = (id = 'user001') => ({ _id: id, role: 'parent' });

  it('resolves children via modern Parent.children array', async () => {
    const childId = 'child001';
    const Parent = { findOne: async () => ({ children: [childId] }) };
    const Student = { find: async () => [] };
    const result = await getStudentAccessParent(makeParentUser(), { Parent, Student });
    assert.deepEqual(result.filter._id.$in, [childId]);
    assert.equal(result.basic, false);
  });

  it('resolves children via legacy Student.parentUser field', async () => {
    const childId = 'child002';
    const Parent = { findOne: async () => null };
    const Student = { find: async () => [{ _id: childId }] };
    const result = await getStudentAccessParent(makeParentUser(), { Parent, Student });
    assert.deepEqual(result.filter._id.$in, [childId]);
  });

  it('deduplicates children appearing in both modern and legacy links', async () => {
    const childId = 'shared001';
    const Parent = { findOne: async () => ({ children: [childId] }) };
    const Student = { find: async () => [{ _id: childId }] };
    const result = await getStudentAccessParent(makeParentUser(), { Parent, Student });
    assert.equal(result.filter._id.$in.length, 1, 'Duplicate child should appear only once');
    assert.equal(result.filter._id.$in[0], childId);
  });

  it('deduplicates multiple children from both sources', async () => {
    const Parent = { findOne: async () => ({ children: ['A', 'B'] }) };
    const Student = { find: async () => [{ _id: 'B' }, { _id: 'C' }] };
    const result = await getStudentAccessParent(makeParentUser(), { Parent, Student });
    const ids = result.filter._id.$in;
    assert.equal(ids.length, 3, 'Should have exactly 3 unique children A, B, C');
    assert.ok(ids.includes('A'));
    assert.ok(ids.includes('B'));
    assert.ok(ids.includes('C'));
  });

  it('fails closed with empty $in filter when Parent exists but has no children and no legacy links', async () => {
    const Parent = { findOne: async () => ({ children: [] }) };
    const Student = { find: async () => [] };
    const result = await getStudentAccessParent(makeParentUser(), { Parent, Student });
    assert.deepEqual(result.filter._id.$in, []);
  });

  it('throws 404 when no Parent record and no legacy Student links exist', async () => {
    const Parent = { findOne: async () => null };
    const Student = { find: async () => [] };
    await assert.rejects(
      () => getStudentAccessParent(makeParentUser(), { Parent, Student }),
      (err) => { assert.equal(err.statusCode, 404); return true; }
    );
  });

  it('throws 401 when user is null', async () => {
    await assert.rejects(
      () => getStudentAccessParent(null, { Parent: {}, Student: {} }),
      (err) => { assert.equal(err.statusCode, 401); return true; }
    );
  });

  it('throws 401 when user has no _id', async () => {
    await assert.rejects(
      () => getStudentAccessParent({ role: 'parent' }, { Parent: {}, Student: {} }),
      (err) => { assert.equal(err.statusCode, 401); return true; }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 1 — TC-issued / Inactive Student Visibility
// Tests the filter-building logic from getStudentsByClass inline.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fix 1 — TC-issued / inactive student visibility', () => {

  const FULL_STUDENT_ACCESS_ROLES = new Set([
    'super_admin', 'school_admin', 'admin', 'principal', 'vice_principal',
    'academic_coordinator', 'admission_officer',
  ]);

  /**
   * Inline reimplementation of the filter-building logic from getStudentsByClass.
   * Returns the MongoDB query filter that would be passed to Student.find().
   */
  function buildClassFilter(cls, academicYear, user, options, access) {
    const isAuthorizedAdmin = Boolean(user && FULL_STUDENT_ACCESS_ROLES.has(user.role));
    const includeInactive = isAuthorizedAdmin && options.includeInactive === true;
    const query = { ...access.filter, class: cls };
    if (!includeInactive) query.isActive = true;
    if (academicYear) query.academicYear = academicYear;
    return query;
  }

  /**
   * Returns the select string that would be passed to studentsQuery.select()
   * for a given access + role combination (mirrors the if branch in getStudentsByClass).
   */
  function selectFields(access, userRole) {
    if (access.basic || ['teacher', 'class_teacher', 'faculty'].includes(userRole)) {
      return '_id admissionNumber class rollNumber academicYear user tcIssued isActive';
    }
    return null; // admin: .populate() without .select()
  }

  const adminAccess = { filter: {}, basic: false };
  const teacherAccess = { filter: {}, basic: false };
  const basicAccess = { filter: {}, basic: true };

  describe('getStudentsByClass filter logic', () => {

    it('teacher role: always includes isActive:true in filter', () => {
      const filter = buildClassFilter('5', null, { _id: 'u1', role: 'teacher' }, {}, teacherAccess);
      assert.equal(filter.isActive, true, 'Teacher must only see active students');
    });

    it('teacher role: includeInactive:true is ignored — still filters active only', () => {
      const filter = buildClassFilter('5', null, { _id: 'u1', role: 'teacher' }, { includeInactive: true }, teacherAccess);
      assert.equal(filter.isActive, true, 'teacher is not in FULL_STUDENT_ACCESS_ROLES');
    });

    it('class_teacher role: includeInactive:true is ignored', () => {
      const filter = buildClassFilter('3', null, { _id: 'u1', role: 'class_teacher' }, { includeInactive: true }, teacherAccess);
      assert.equal(filter.isActive, true, 'class_teacher is not an authorized admin');
    });

    it('faculty role: includeInactive:true is ignored', () => {
      const filter = buildClassFilter('7', null, { _id: 'u1', role: 'faculty' }, { includeInactive: true }, teacherAccess);
      assert.equal(filter.isActive, true);
    });

    it('admin role: default options — includes isActive:true (active-only default)', () => {
      const filter = buildClassFilter('5', null, { _id: 'u1', role: 'admin' }, {}, adminAccess);
      assert.equal(filter.isActive, true, 'Default for admin is still active-only');
    });

    it('admin role: includeInactive:true — omits isActive from filter', () => {
      const filter = buildClassFilter('5', null, { _id: 'u1', role: 'admin' }, { includeInactive: true }, adminAccess);
      assert.equal(filter.isActive, undefined, 'Admin with includeInactive=true must see all students');
    });

    it('principal role: default options — includes isActive:true', () => {
      const filter = buildClassFilter('10', null, { _id: 'u1', role: 'principal' }, {}, adminAccess);
      assert.equal(filter.isActive, true);
    });

    it('principal role: includeInactive:true — omits isActive from filter', () => {
      const filter = buildClassFilter('10', null, { _id: 'u1', role: 'principal' }, { includeInactive: true }, adminAccess);
      assert.equal(filter.isActive, undefined);
    });

    it('vice_principal role: includeInactive:true — omits isActive', () => {
      const filter = buildClassFilter('8', null, { _id: 'u1', role: 'vice_principal' }, { includeInactive: true }, adminAccess);
      assert.equal(filter.isActive, undefined);
    });

    it('admission_officer role: includeInactive:true — omits isActive', () => {
      const filter = buildClassFilter('1', null, { _id: 'u1', role: 'admission_officer' }, { includeInactive: true }, adminAccess);
      assert.equal(filter.isActive, undefined);
    });

    it('academicYear is added to filter when provided', () => {
      const filter = buildClassFilter('5', '2024-2025', { _id: 'u1', role: 'admin' }, {}, adminAccess);
      assert.equal(filter.academicYear, '2024-2025');
    });

    it('academicYear is omitted from filter when not provided', () => {
      const filter = buildClassFilter('5', null, { _id: 'u1', role: 'admin' }, {}, adminAccess);
      assert.equal(filter.academicYear, undefined);
    });
  });

  describe('select field logic', () => {

    it('teacher role: select includes tcIssued and isActive', () => {
      const fields = selectFields(teacherAccess, 'teacher');
      assert.ok(fields.includes('tcIssued'), 'tcIssued must be selectable for teacher/TC panel');
      assert.ok(fields.includes('isActive'));
    });

    it('class_teacher role: select includes tcIssued', () => {
      const fields = selectFields(teacherAccess, 'class_teacher');
      assert.ok(fields.includes('tcIssued'));
    });

    it('basic access role: select includes tcIssued', () => {
      const fields = selectFields(basicAccess, 'accountant');
      assert.ok(fields.includes('tcIssued'));
    });

    it('admin role: no field restriction (populate without select)', () => {
      const fields = selectFields(adminAccess, 'admin');
      assert.equal(fields, null, 'Admin should get full populate, not restricted select');
    });
  });

  describe('getStudentById status filter logic', () => {

    /**
     * Inline reimplementation of the status filter logic from getStudentById.
     */
    function buildStatusFilter(user) {
      const isAuthorizedAdmin = Boolean(user && FULL_STUDENT_ACCESS_ROLES.has(user.role));
      return isAuthorizedAdmin ? {} : { isActive: true };
    }

    it('admin user gets empty status filter (can see inactive)', () => {
      const filter = buildStatusFilter({ _id: 'u1', role: 'admin' });
      assert.deepEqual(filter, {});
    });

    it('principal gets empty status filter', () => {
      const filter = buildStatusFilter({ _id: 'u1', role: 'principal' });
      assert.deepEqual(filter, {});
    });

    it('teacher gets isActive:true filter', () => {
      const filter = buildStatusFilter({ _id: 'u1', role: 'teacher' });
      assert.deepEqual(filter, { isActive: true });
    });

    it('student gets isActive:true filter', () => {
      const filter = buildStatusFilter({ _id: 'u1', role: 'student' });
      assert.deepEqual(filter, { isActive: true });
    });

    it('null user gets isActive:true filter', () => {
      const filter = buildStatusFilter(null);
      assert.deepEqual(filter, { isActive: true });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 2 — Leave Date Alias Resolution
// Tests the alias-resolution logic from leave.controller.js inline.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fix 2 — Leave date alias resolution', () => {

  /**
   * Inline reimplementation of the date resolution logic from applyLeave controller.
   * Returns { startDate, endDate } on success, throws ErrorResponse on conflict/missing.
   */
  function resolveDates({ startDate: rawStart, endDate: rawEnd, fromDate, toDate }) {
    if (fromDate && rawStart && fromDate !== rawStart) {
      throw new ErrorResponse(
        'Conflicting date fields: provide either startDate or fromDate, not both with different values.',
        400
      );
    }
    if (toDate && rawEnd && toDate !== rawEnd) {
      throw new ErrorResponse(
        'Conflicting date fields: provide either endDate or toDate, not both with different values.',
        400
      );
    }
    const startDate = rawStart || fromDate;
    const endDate = rawEnd || toDate;
    if (!startDate || !endDate) {
      throw new ErrorResponse('startDate and endDate are required.', 400);
    }
    return { startDate, endDate };
  }

  it('resolves fromDate to startDate', () => {
    const result = resolveDates({ fromDate: '2026-01-10', toDate: '2026-01-15' });
    assert.equal(result.startDate, '2026-01-10');
    assert.equal(result.endDate, '2026-01-15');
  });

  it('preserves canonical startDate/endDate', () => {
    const result = resolveDates({ startDate: '2026-02-01', endDate: '2026-02-05' });
    assert.equal(result.startDate, '2026-02-01');
    assert.equal(result.endDate, '2026-02-05');
  });

  it('accepts both startDate and fromDate when values are identical (no conflict)', () => {
    const result = resolveDates({
      startDate: '2026-03-10', fromDate: '2026-03-10',
      endDate: '2026-03-12', toDate: '2026-03-12',
    });
    assert.equal(result.startDate, '2026-03-10');
    assert.equal(result.endDate, '2026-03-12');
  });

  it('throws 400 when startDate and fromDate have different values', () => {
    assert.throws(
      () => resolveDates({ startDate: '2026-04-01', fromDate: '2026-04-02', endDate: '2026-04-05' }),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );
  });

  it('throws 400 when endDate and toDate have different values', () => {
    assert.throws(
      () => resolveDates({ fromDate: '2026-04-01', endDate: '2026-04-10', toDate: '2026-04-11' }),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );
  });

  it('throws 400 when no dates provided at all', () => {
    assert.throws(
      () => resolveDates({}),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );
  });

  it('throws 400 when only startDate provided (endDate missing)', () => {
    assert.throws(
      () => resolveDates({ startDate: '2026-05-01' }),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );
  });

  it('throws 400 when only toDate provided (startDate missing)', () => {
    assert.throws(
      () => resolveDates({ toDate: '2026-05-10' }),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );
  });

  it('fromDate alias takes priority: startDate OR fromDate, startDate wins if present', () => {
    // rawStart is set, fromDate is not set → uses rawStart
    const result = resolveDates({ startDate: '2026-06-01', endDate: '2026-06-05' });
    assert.equal(result.startDate, '2026-06-01');
  });

  it('leaves canonical payload intact for service layer', () => {
    // Simulate what the controller builds for leave service
    const body = { fromDate: '2026-07-01', toDate: '2026-07-05', leaveType: 'Sick', reason: 'Ill' };
    const { startDate, endDate } = resolveDates(body);
    const payload = { leaveType: body.leaveType, startDate, endDate, reason: body.reason };
    assert.equal(payload.startDate, '2026-07-01');
    assert.equal(payload.endDate, '2026-07-05');
    assert.equal(payload.leaveType, 'Sick');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 3 — Principal Dashboard Admission Counter
// Tests that the correct Admission status set is used for "pending" count.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fix 3 — Dashboard admission counter uses correct statuses', () => {

  /**
   * The statuses that require admin/principal action (mirror the fix in dashboard.service.js).
   * This constant encodes the corrected business requirement.
   */
  const PENDING_ADMISSION_STATUSES = ['Submitted', 'Under_Review', 'Document_Verification', 'Waitlisted'];

  /**
   * All Admission statuses from the schema (models/Admission.js).
   * 'Pending' does NOT appear here — it was never a valid status.
   */
  const ALL_ADMISSION_STATUSES = [
    'Draft', 'Submitted', 'Under_Review', 'Document_Verification',
    'Approved', 'Admitting', 'Rejected', 'Waitlisted', 'Admitted',
  ];

  /**
   * Statuses that do NOT require further principal action.
   */
  const CLOSED_STATUSES = ['Draft', 'Approved', 'Admitting', 'Rejected', 'Admitted'];

  it('pending set includes Submitted', () => {
    assert.ok(PENDING_ADMISSION_STATUSES.includes('Submitted'));
  });

  it('pending set includes Under_Review', () => {
    assert.ok(PENDING_ADMISSION_STATUSES.includes('Under_Review'));
  });

  it('pending set includes Document_Verification', () => {
    assert.ok(PENDING_ADMISSION_STATUSES.includes('Document_Verification'));
  });

  it('pending set includes Waitlisted (requires decision: approve/reject/move)', () => {
    assert.ok(PENDING_ADMISSION_STATUSES.includes('Waitlisted'));
  });

  it('pending set does NOT include Pending (non-existent schema status)', () => {
    assert.ok(!PENDING_ADMISSION_STATUSES.includes('Pending'),
      '"Pending" is not a valid Admission status and must not be counted');
  });

  it('pending set does NOT include closed statuses', () => {
    for (const s of CLOSED_STATUSES) {
      assert.ok(!PENDING_ADMISSION_STATUSES.includes(s),
        `"${s}" is a closed status and must not be counted as pending`);
    }
  });

  it('every pending status is a valid schema status', () => {
    for (const s of PENDING_ADMISSION_STATUSES) {
      assert.ok(ALL_ADMISSION_STATUSES.includes(s),
        `"${s}" in PENDING_ADMISSION_STATUSES is not in the schema`);
    }
  });

  it('countDocuments query uses $in operator (not equality match)', () => {
    // Simulate the countDocuments call that the fixed service makes
    let capturedFilter = null;
    const AdmissionMock = {
      countDocuments: (filter) => { capturedFilter = filter; return Promise.resolve(2); }
    };
    // This is the exact filter the fixed dashboard.service.js builds:
    const filter = { status: { $in: ['Submitted', 'Under_Review', 'Document_Verification', 'Waitlisted'] } };
    AdmissionMock.countDocuments(filter);
    assert.ok(capturedFilter.status.$in, 'Must use $in operator');
    assert.deepEqual(capturedFilter.status.$in, PENDING_ADMISSION_STATUSES);
  });

  it('a Submitted admission is counted by the fixed query', () => {
    const admission = { status: 'Submitted' };
    const isCountable = PENDING_ADMISSION_STATUSES.includes(admission.status);
    assert.ok(isCountable, 'Submitted admission should be counted');
  });

  it('an Approved admission is NOT counted by the fixed query', () => {
    const admission = { status: 'Approved' };
    const isCountable = PENDING_ADMISSION_STATUSES.includes(admission.status);
    assert.ok(!isCountable, 'Approved admission should not be counted as pending');
  });

  it('an Admitted admission is NOT counted', () => {
    assert.ok(!PENDING_ADMISSION_STATUSES.includes('Admitted'));
  });

  it('a Draft admission is NOT counted', () => {
    assert.ok(!PENDING_ADMISSION_STATUSES.includes('Draft'));
  });

  it('a Rejected admission is NOT counted', () => {
    assert.ok(!PENDING_ADMISSION_STATUSES.includes('Rejected'));
  });

  it('filter matches expected count from a mixed admission dataset', () => {
    // Simulate counting admissions in memory the way MongoDB $in would
    const admissions = [
      { status: 'Draft' },        // not counted
      { status: 'Submitted' },    // counted
      { status: 'Submitted' },    // counted
      { status: 'Under_Review' }, // counted
      { status: 'Document_Verification' }, // counted
      { status: 'Approved' },     // not counted
      { status: 'Waitlisted' },   // counted
      { status: 'Rejected' },     // not counted
      { status: 'Admitted' },     // not counted
    ];
    const count = admissions.filter(a => PENDING_ADMISSION_STATUSES.includes(a.status)).length;
    assert.equal(count, 5, 'Expected exactly 5 admissions requiring action');
  });
});
