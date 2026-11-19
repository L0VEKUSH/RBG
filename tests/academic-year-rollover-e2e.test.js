'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Student = require('../models/Student');
const User = require('../models/User');
const AcademicYear = require('../models/AcademicYear');
const RolloverExecution = require('../models/RolloverExecution');
const AuditLog = require('../models/AuditLog');
const rolloverService = require('../services/rollover.service');
const { requirePermission } = require('../middleware/authorization.middleware');
const { schoolDayBounds, nextSchoolDate, schoolDateKey } = require('../utils/attendance-date');

const TEST_PORT = 27019;
const REPL_SET_NAME = 'rbgRolloverIT';
const DB_NAME = `erp_rollover_it_${Date.now()}`;
const MONGO_URI = `mongodb://127.0.0.1:${TEST_PORT}/${DB_NAME}?replicaSet=${REPL_SET_NAME}`;

const SOURCE_YEAR = '2026-2027';
const DEST_YEAR = '2027-2028';

test.describe('Academic Year Rollover E2E Isolated Replica-Set Verification', () => {
  let adminUser;
  let teacherUser;
  let testStudents = [];

  test.before(async () => {
    // Safety check 1: Target URI must strictly point to test port and test db prefix
    assert.match(MONGO_URI, /^mongodb:\/\/127\.0\.0\.1:27019\/erp_rollover_it_/);
    assert.doesNotMatch(MONGO_URI, /school_management_db/);
    assert.doesNotMatch(MONGO_URI, /27017/);

    await mongoose.connect(MONGO_URI);

    // Safety check 2: Verify live server identity and writable primary topology
    const admin = mongoose.connection.db.admin();
    const hello = await admin.command({ hello: 1 });
    assert.equal(hello.isWritablePrimary, true, 'Target MongoDB must be a writable primary');
    assert.equal(hello.setName, REPL_SET_NAME, 'Replica set name must match rbgRolloverIT');

    // Create Admin User
    adminUser = await User.create({
      name: 'System Administrator',
      email: `admin_${Date.now()}@rbg.edu`,
      password: 'TestPassword123!',
      role: 'school_admin',
      permissions: ['academic-years.view', 'academic-years.manage'],
      isActive: true,
    });

    // Create Teacher User (non-admin)
    teacherUser = await User.create({
      name: 'Test Teacher',
      email: `teacher_${Date.now()}@rbg.edu`,
      password: 'TestPassword123!',
      role: 'teacher',
      permissions: [],
      isActive: true,
    });

    // Create Source & Destination Academic Years
    await AcademicYear.create({
      name: SOURCE_YEAR,
      startDate: schoolDayBounds('2026-04-01').start,
      endDate: schoolDayBounds('2027-03-31').start,
      isActive: true,
      isCurrent: true,
    });

    await AcademicYear.create({
      name: DEST_YEAR,
      startDate: schoolDayBounds('2027-04-01').start,
      endDate: schoolDayBounds('2028-03-31').start,
      isActive: true,
      isCurrent: false,
    });

    // Create 8 representative test students and linked portal users
    const studentConfigs = [
      { num: 1, class: '10', active: true, tc: false, status: 'enrolled', note: 'target: promote to 11' },
      { num: 2, class: '11', active: true, tc: false, status: 'enrolled', note: 'target: promote to 12' },
      { num: 3, class: '12', active: true, tc: false, status: 'enrolled', note: 'target: graduate' },
      { num: 4, class: '5',  active: true, tc: false, status: 'enrolled', note: 'target: continue' },
      { num: 5, class: '6',  active: true, tc: false, status: 'enrolled', note: 'target: withdraw' },
      { num: 6, class: '7',  active: true, tc: false, status: 'enrolled', note: 'target: transfer' },
      { num: 7, class: '8',  active: false, tc: false, status: 'withdrawn', note: 'target: leave_unchanged' },
      { num: 8, class: '9',  active: false, tc: true, status: 'transferred', note: 'target: leave_unchanged' },
    ];

    for (const conf of studentConfigs) {
      const user = await User.create({
        name: `Student ${conf.num}`,
        email: `student_${conf.num}_${Date.now()}@rbg.edu`,
        password: 'TestPassword123!',
        role: 'student',
        isActive: conf.active,
      });

      const s = await Student.create({
        user: user._id,
        name: user.name,
        admissionNumber: `ADM-E2E-${conf.num}-${Date.now().toString().slice(-4)}`,
        class: conf.class,
        academicYear: SOURCE_YEAR,
        father: { name: `Father ${conf.num}` },
        mother: { name: `Mother ${conf.num}` },
        isActive: conf.active,
        tcIssued: conf.tc,
        tcDate: conf.tc ? new Date('2026-11-01T00:00:00.000Z') : undefined,
        tcLastEnrolledDate: conf.tc ? schoolDayBounds('2026-10-31').start : undefined,
        academicStatus: conf.status,
        enrollmentEffectiveFrom: schoolDayBounds('2026-04-01').start,
        enrollmentHistory: [],
        rollNumber: conf.num,
        stream: 'N/A',
      });

      testStudents.push({ s, user, conf });
    }
  });

  test.after(async () => {
    // Phase H: Safe cleanup confined strictly to the dedicated test database
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const currentDb = mongoose.connection.db.databaseName;
      if (currentDb.startsWith('erp_rollover_it_') && !currentDb.includes('school_management_db')) {
        await mongoose.connection.db.dropDatabase();
      }
      await mongoose.disconnect();
    }
  });

  test('Phase C: complete rollover draft creation, decision validation, and execution rules', async () => {
    // 1. Create draft
    const draft = await rolloverService.createDraft({
      sourceAcademicYear: SOURCE_YEAR,
      destinationAcademicYear: DEST_YEAR,
      actor: adminUser,
    });
    assert.equal(draft.status, 'draft');
    assert.equal(draft.revision, 0);
    assert.equal(draft.decisions.length, 8, 'All 8 students in source year must be loaded');
    assert.ok(draft.decisions.every(d => d.action === 'pending'), 'Every student must initialize to pending');

    // 2. Unresolved pending execution guard
    await assert.rejects(
      rolloverService.execute(draft._id, adminUser),
      error => error.statusCode === 409 && /explicit decision/.test(error.message)
    );

    // 3. Ineligible student decision rules
    const s7 = testStudents[6].s;
    const s8 = testStudents[7].s;
    await assert.rejects(
      rolloverService.saveDecisions(draft._id, {
        expectedRevision: 0,
        decisions: [{ student: s7._id, action: 'promote', currentClass: '8', currentAcademicYear: SOURCE_YEAR, currentIsActive: false, currentTcIssued: false }],
      }, adminUser),
      error => error.statusCode === 409 && /Inactive or TC-issued/.test(error.message)
    );

    await assert.rejects(
      rolloverService.saveDecisions(draft._id, {
        expectedRevision: 0,
        decisions: [{ student: s8._id, action: 'continue', currentClass: '9', currentAcademicYear: SOURCE_YEAR, currentIsActive: false, currentTcIssued: true }],
      }, adminUser),
      error => error.statusCode === 409 && /Inactive or TC-issued/.test(error.message)
    );

    // 4. Class 12 promote rejection
    const s3 = testStudents[2].s;
    await assert.rejects(
      rolloverService.saveDecisions(draft._id, {
        expectedRevision: 0,
        decisions: [{ student: s3._id, action: 'promote', currentClass: '12', currentAcademicYear: SOURCE_YEAR, currentIsActive: true, currentTcIssued: false }],
      }, adminUser),
      error => error.statusCode === 400 && /Class 12/.test(error.message)
    );

    // 5. Effective date boundary validation
    const s6 = testStudents[5].s;
    await assert.rejects(
      rolloverService.saveDecisions(draft._id, {
        expectedRevision: 0,
        decisions: [{ student: s6._id, action: 'transfer', currentClass: '7', currentAcademicYear: SOURCE_YEAR, currentIsActive: true, currentTcIssued: false, effectiveDate: '2026-03-31' }],
      }, adminUser),
      error => error.statusCode === 400 && /source academic year/.test(error.message)
    );

    await assert.rejects(
      rolloverService.saveDecisions(draft._id, {
        expectedRevision: 0,
        decisions: [{ student: s6._id, action: 'transfer', currentClass: '7', currentAcademicYear: SOURCE_YEAR, currentIsActive: true, currentTcIssued: false, effectiveDate: '2027-04-01' }],
      }, adminUser),
      error => error.statusCode === 400 && /source academic year/.test(error.message)
    );

    // 6. Save all 8 valid decisions with expectedRevision
    const validDecisions = [
      { student: testStudents[0].s._id, action: 'promote', currentClass: '10', currentAcademicYear: SOURCE_YEAR, currentIsActive: true, currentTcIssued: false },
      { student: testStudents[1].s._id, action: 'promote', currentClass: '11', currentAcademicYear: SOURCE_YEAR, currentIsActive: true, currentTcIssued: false },
      { student: testStudents[2].s._id, action: 'graduate', currentClass: '12', currentAcademicYear: SOURCE_YEAR, currentIsActive: true, currentTcIssued: false, effectiveDate: '2027-03-31' },
      { student: testStudents[3].s._id, action: 'continue', currentClass: '5', currentAcademicYear: SOURCE_YEAR, currentIsActive: true, currentTcIssued: false },
      { student: testStudents[4].s._id, action: 'withdraw', currentClass: '6', currentAcademicYear: SOURCE_YEAR, currentIsActive: true, currentTcIssued: false, effectiveDate: '2027-03-31' },
      { student: testStudents[5].s._id, action: 'transfer', currentClass: '7', currentAcademicYear: SOURCE_YEAR, currentIsActive: true, currentTcIssued: false, effectiveDate: '2027-03-31' },
      { student: testStudents[6].s._id, action: 'leave_unchanged', currentClass: '8', currentAcademicYear: SOURCE_YEAR, currentIsActive: false, currentTcIssued: false },
      { student: testStudents[7].s._id, action: 'leave_unchanged', currentClass: '9', currentAcademicYear: SOURCE_YEAR, currentIsActive: false, currentTcIssued: true },
    ];

    const saved = await rolloverService.saveDecisions(draft._id, {
      expectedRevision: 0,
      decisions: validDecisions,
    }, adminUser);
    assert.equal(saved.revision, 1);
    assert.equal(saved.status, 'draft');

    // 7. Execute the rollover in real MongoDB replica-set transaction
    const executed = await rolloverService.execute(draft._id, adminUser, {
      ipAddress: '127.0.0.1',
      userAgent: 'E2E-ReplicaSet-Test',
    });
    assert.equal(executed.status, 'completed');
    assert.ok(executed.executedAt instanceof Date);
  });

  test('Phase D: direct database verification of transaction outcomes and document state', async () => {
    // Reload all records directly from the database without cache
    const s1 = await Student.findById(testStudents[0].s._id);
    const s2 = await Student.findById(testStudents[1].s._id);
    const s3 = await Student.findById(testStudents[2].s._id);
    const s4 = await Student.findById(testStudents[3].s._id);
    const s5 = await Student.findById(testStudents[4].s._id);
    const s6 = await Student.findById(testStudents[5].s._id);
    const s7 = await Student.findById(testStudents[6].s._id);
    const s8 = await Student.findById(testStudents[7].s._id);

    // Student 1: 10 -> 11 promoted
    assert.equal(s1.class, '11');
    assert.equal(s1.academicYear, DEST_YEAR);
    assert.equal(s1.academicStatus, 'enrolled');
    assert.equal(s1.isActive, true);
    assert.equal(s1.enrollmentHistory.length, 1);
    assert.equal(s1.enrollmentHistory[0].class, '10');
    assert.equal(s1.enrollmentHistory[0].academicYear, SOURCE_YEAR);

    // Student 2: 11 -> 12 promoted
    assert.equal(s2.class, '12');
    assert.equal(s2.academicYear, DEST_YEAR);
    assert.equal(s2.academicStatus, 'enrolled');
    assert.equal(s2.isActive, true);
    assert.equal(s2.enrollmentHistory.length, 1);
    assert.equal(s2.enrollmentHistory[0].class, '11');

    // Student 3: 12 graduated
    assert.equal(s3.class, '12');
    assert.equal(s3.academicYear, SOURCE_YEAR);
    assert.equal(s3.academicStatus, 'graduated');
    assert.equal(s3.isActive, false);
    const u3 = await User.findById(testStudents[2].user._id);
    assert.equal(u3.isActive, false, 'Linked user must be deactivated on graduation');

    // Student 4: 5 continue
    assert.equal(s4.class, '5');
    assert.equal(s4.academicYear, DEST_YEAR);
    assert.equal(s4.academicStatus, 'enrolled');
    assert.equal(s4.isActive, true);

    // Student 5: 6 withdraw
    assert.equal(s5.class, '6');
    assert.equal(s5.academicYear, SOURCE_YEAR);
    assert.equal(s5.academicStatus, 'withdrawn');
    assert.equal(s5.isActive, false);
    const u5 = await User.findById(testStudents[4].user._id);
    assert.equal(u5.isActive, false, 'Linked user must be deactivated on withdrawal');

    // Student 6: 7 transfer
    assert.equal(s6.class, '7');
    assert.equal(s6.academicYear, SOURCE_YEAR);
    assert.equal(s6.academicStatus, 'transferred');
    assert.equal(s6.isActive, false);
    assert.equal(s6.tcIssued, true);
    assert.ok(s6.tcDate instanceof Date);
    assert.equal(schoolDateKey(s6.tcLastEnrolledDate), '2027-03-31');
    assert.equal(schoolDateKey(s6.enrollmentHistory[0].promotedDate), '2027-04-01', 'History boundary must be next school date');
    const u6 = await User.findById(testStudents[5].user._id);
    assert.equal(u6.isActive, false, 'Linked user must be deactivated on transfer');

    // Student 7: leave_unchanged (inactive student completely unchanged)
    assert.equal(s7.class, '8');
    assert.equal(s7.academicYear, SOURCE_YEAR);
    assert.equal(s7.isActive, false);
    assert.equal(s7.tcIssued, false);
    assert.equal(s7.academicStatus, 'withdrawn');
    assert.equal(s7.enrollmentHistory.length, 0);

    // Student 8: leave_unchanged (TC-issued student completely unchanged)
    assert.equal(s8.class, '9');
    assert.equal(s8.academicYear, SOURCE_YEAR);
    assert.equal(s8.isActive, false);
    assert.equal(s8.tcIssued, true);
    assert.equal(s8.academicStatus, 'transferred');
    assert.equal(s8.enrollmentHistory.length, 0);

    // Academic Year states
    const src = await AcademicYear.findOne({ name: SOURCE_YEAR });
    const dst = await AcademicYear.findOne({ name: DEST_YEAR });
    assert.equal(src.isCurrent, false);
    assert.equal(dst.isCurrent, true);

    // Audit Log verified
    const audits = await AuditLog.find({ action: 'academic_year_rollover' });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].details.decisions.length, 8);
    assert.ok(audits[0].details.decisions.every(d => d.result === 'applied'));
  });

  test('Phase E: real database concurrency for decision saves, save vs execute, and duplicate execution', async () => {
    // Create new separate draft for concurrency testing
    // Create secondary academic years
    const sYear2 = '2028-2029';
    const dYear2 = '2029-2030';
    await AcademicYear.create({
      name: sYear2,
      startDate: schoolDayBounds('2028-04-01').start,
      endDate: schoolDayBounds('2029-03-31').start,
      isActive: true,
      isCurrent: true,
    });
    await AcademicYear.create({
      name: dYear2,
      startDate: schoolDayBounds('2029-04-01').start,
      endDate: schoolDayBounds('2030-03-31').start,
      isActive: true,
      isCurrent: false,
    });

    const cUser = await User.create({
      name: 'Concurrency User',
      email: `conc_user_${Date.now()}@rbg.edu`,
      password: 'TestPassword123!',
      role: 'student',
      isActive: true,
    });

    const cStudent = await Student.create({
      user: cUser._id,
      name: 'Concurrency Student',
      admissionNumber: `ADM-CONC-${Date.now()}`,
      class: '5',
      academicYear: sYear2,
      father: { name: 'Father Concurrency' },
      mother: { name: 'Mother Concurrency' },
      isActive: true,
      tcIssued: false,
      academicStatus: 'enrolled',
      enrollmentEffectiveFrom: schoolDayBounds('2028-04-01').start,
      rollNumber: 99,
      stream: 'N/A',
    });

    const draft2 = await rolloverService.createDraft({
      sourceAcademicYear: sYear2,
      destinationAcademicYear: dYear2,
      actor: adminUser,
    });
    assert.equal(draft2.revision, 0);

    // 1. Real concurrent saves with same expectedRevision (0)
    const savePromise1 = rolloverService.saveDecisions(draft2._id, {
      expectedRevision: 0,
      decisions: [{ student: cStudent._id, action: 'continue', currentClass: '5', currentAcademicYear: sYear2, currentIsActive: true, currentTcIssued: false }],
    }, adminUser);

    const savePromise2 = rolloverService.saveDecisions(draft2._id, {
      expectedRevision: 0,
      decisions: [{ student: cStudent._id, action: 'promote', currentClass: '5', currentAcademicYear: sYear2, currentIsActive: true, currentTcIssued: false }],
    }, adminUser);

    const results = await Promise.allSettled([savePromise1, savePromise2]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'Exactly one concurrent save must succeed');
    assert.equal(rejected.length, 1, 'The other concurrent save must be rejected');
    assert.equal(rejected[0].reason.statusCode, 409, 'Losing save must receive HTTP 409 Conflict');

    const dbDraft = await RolloverExecution.findById(draft2._id);
    assert.equal(dbDraft.revision, 1, 'Final revision in MongoDB must be 1');

    // 2. Duplicate execution race
    const execPromise1 = rolloverService.execute(draft2._id, adminUser);
    const execPromise2 = rolloverService.execute(draft2._id, adminUser);

    const execResults = await Promise.allSettled([execPromise1, execPromise2]);
    const execFulfilled = execResults.filter(r => r.status === 'fulfilled');
    const execRejected = execResults.filter(r => r.status === 'rejected');

    assert.equal(execFulfilled.length, 1, 'Exactly one concurrent execution must succeed');
    assert.equal(execRejected.length, 1, 'Duplicate execution must be rejected');
    assert.equal(execRejected[0].reason.statusCode, 409, 'Duplicate execution must return HTTP 409');

    // 3. Save against completed rollover cannot revert status to draft
    await assert.rejects(
      rolloverService.saveDecisions(draft2._id, {
        expectedRevision: 1,
        decisions: [{ student: cStudent._id, action: 'continue', currentClass: '5', currentAcademicYear: sYear2, currentIsActive: true, currentTcIssued: false }],
      }, adminUser),
      error => error.statusCode === 409 && /draft/.test(error.message)
    );

    const finalDraft = await RolloverExecution.findById(draft2._id);
    assert.equal(finalDraft.status, 'completed', 'Completed status cannot be overwritten by saveDecisions');
  });

  test('Phase F: real transaction rollback on injected mid-flight failure', async () => {
    // Create third academic year pair
    const sYear3 = '2030-2031';
    const dYear3 = '2031-2032';
    await AcademicYear.create({
      name: sYear3,
      startDate: schoolDayBounds('2030-04-01').start,
      endDate: schoolDayBounds('2031-03-31').start,
      isActive: true,
      isCurrent: true,
    });
    await AcademicYear.create({
      name: dYear3,
      startDate: schoolDayBounds('2031-04-01').start,
      endDate: schoolDayBounds('2032-03-31').start,
      isActive: true,
      isCurrent: false,
    });

    const rbUser = await User.create({
      name: 'Rollback User',
      email: `rollback_user_${Date.now()}@rbg.edu`,
      password: 'TestPassword123!',
      role: 'student',
      isActive: true,
    });

    const rbStudent1 = await Student.create({
      user: rbUser._id,
      name: 'Rollback Student 1',
      admissionNumber: `ADM-RB-1-${Date.now()}`,
      class: '5',
      academicYear: sYear3,
      father: { name: 'Father RB1' },
      mother: { name: 'Mother RB1' },
      isActive: true,
      tcIssued: false,
      academicStatus: 'enrolled',
      enrollmentEffectiveFrom: schoolDayBounds('2030-04-01').start,
      rollNumber: 101,
      stream: 'N/A',
    });

    const rbUser2 = await User.create({
      name: 'Rollback User 2',
      email: `rollback_user_2_${Date.now()}@rbg.edu`,
      password: 'TestPassword123!',
      role: 'student',
      isActive: true,
    });

    const rbStudent2 = await Student.create({
      user: rbUser2._id,
      name: 'Rollback Student 2',
      admissionNumber: `ADM-RB-2-${Date.now()}`,
      class: '6',
      academicYear: sYear3,
      father: { name: 'Father RB2' },
      mother: { name: 'Mother RB2' },
      isActive: true,
      tcIssued: false,
      academicStatus: 'enrolled',
      enrollmentEffectiveFrom: schoolDayBounds('2030-04-01').start,
      rollNumber: 102,
      stream: 'N/A',
    });

    const draft3 = await rolloverService.createDraft({
      sourceAcademicYear: sYear3,
      destinationAcademicYear: dYear3,
      actor: adminUser,
    });

    await rolloverService.saveDecisions(draft3._id, {
      expectedRevision: 0,
      decisions: [
        { student: rbStudent1._id, action: 'graduate', currentClass: '5', currentAcademicYear: sYear3, currentIsActive: true, currentTcIssued: false, effectiveDate: '2031-03-31' }, // Invalid graduate for class 5!
        { student: rbStudent2._id, action: 'continue', currentClass: '6', currentAcademicYear: sYear3, currentIsActive: true, currentTcIssued: false },
      ],
    }, adminUser).catch(() => {});

    // Save valid decisions first
    await rolloverService.saveDecisions(draft3._id, {
      expectedRevision: 0,
      decisions: [
        { student: rbStudent1._id, action: 'continue', currentClass: '5', currentAcademicYear: sYear3, currentIsActive: true, currentTcIssued: false },
        { student: rbStudent2._id, action: 'continue', currentClass: '6', currentAcademicYear: sYear3, currentIsActive: true, currentTcIssued: false },
      ],
    }, adminUser);

    // Now inject a mid-flight failure: mutate rbStudent2 in the database so that executeDecision fails on snapshot verification
    await Student.updateOne({ _id: rbStudent2._id }, { $set: { class: '7' } }); // external change!

    // Execute must fail with 409
    await assert.rejects(
      rolloverService.execute(draft3._id, adminUser),
      error => error.statusCode === 409 && /Student changed/.test(error.message)
    );

    // Verify complete rollback in MongoDB
    const reloadedStudent1 = await Student.findById(rbStudent1._id);
    assert.equal(reloadedStudent1.academicYear, sYear3, 'Student 1 write must be rolled back');
    assert.equal(reloadedStudent1.enrollmentHistory.length, 0, 'No history entry may persist');

    const reloadedSrc = await AcademicYear.findOne({ name: sYear3 });
    const reloadedDst = await AcademicYear.findOne({ name: dYear3 });
    assert.equal(reloadedSrc.isCurrent, true, 'Source year current flag must remain true');
    assert.equal(reloadedDst.isCurrent, false, 'Destination year current flag must remain false');

    const reloadedDraft = await RolloverExecution.findById(draft3._id);
    assert.equal(reloadedDraft.status, 'draft', 'Rollover status must roll back to draft');
  });

  test('Phase G: RBAC and route authorization verification', async () => {
    // 1. Unauthenticated actor in service call
    await assert.rejects(
      rolloverService.createDraft({ sourceAcademicYear: SOURCE_YEAR, destinationAcademicYear: DEST_YEAR, actor: null }),
      error => error.statusCode === 401 && /authenticated administrator/.test(error.message)
    );

    // 2. Unauthorized role (teacher) via permission middleware
    let permissionError;
    const req = { user: { role: 'teacher', permissions: [] } };
    const res = {};
    const next = err => { permissionError = err; };
    requirePermission('academic-years.manage')(req, res, next);
    assert.ok(permissionError);
    assert.equal(permissionError.statusCode, 403);

    // 3. Authorized role (school_admin with permission)
    let allowed = false;
    const adminReq = { user: { role: 'school_admin', permissions: ['academic-years.manage'] } };
    requirePermission('academic-years.manage')(adminReq, res, err => {
      if (!err) allowed = true;
    });
    assert.equal(allowed, true);
  });
});
