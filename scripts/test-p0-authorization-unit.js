const assert = require('assert').strict;

const User = require('../models/User');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const Leave = require('../models/LeaveRequest');
const Faculty = require('../models/Faculty');
const Subject = require('../models/Subject');
const Exam = require('../models/Exam');
const SubjectAllocation = require('../models/SubjectAllocation');
const Marks = require('../models/Marks');
const Payment = require('../models/Payment');
const LibraryTransaction = require('../models/LibraryTransaction');
const authService = require('../services/auth.service');
const studentService = require('../services/student.service');
const studentAccess = require('../services/student-access.service');
const parentService = require('../services/parent.service');
const leaveService = require('../services/leave.service');
const marksService = require('../services/marks.service');
const libraryService = require('../services/library.service');
const transportService = require('../services/transport.service');
const feeService = require('../services/fee.service');
const leaveController = require('../controllers/leave.controller');
const { requireRole, requirePermission, requireOwnership } = require('../middleware/authorization.middleware');
const { getRolePermissions } = require('../config/permissions');
const { assertLocalSyntheticSeedTarget } = require('./seed-safety');

const originals = new Map();
function stub(target, key, replacement) {
  if (!originals.has(target)) originals.set(target, new Map());
  const methods = originals.get(target);
  if (!methods.has(key)) methods.set(key, target[key]);
  target[key] = replacement;
}
function restoreAll() {
  for (const [target, methods] of originals) {
    for (const [key, value] of methods) target[key] = value;
  }
  originals.clear();
}
function queryResult(value) {
  const query = {
    select() { return query; },
    populate() { return query; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
  return query;
}

async function run() {
  const developmentSeedEnv = {
    NODE_ENV: 'development',
    ALLOW_DEMO_SEED: '1',
    MONGO_URI: 'mongodb://127.0.0.1:27017/school_management_dev',
  };
  assert.equal(assertLocalSyntheticSeedTarget({
    env: developmentSeedEnv,
    expectedEnvironment: 'development',
    optInVariable: 'ALLOW_DEMO_SEED',
    databaseName: 'school_management_dev',
  }), developmentSeedEnv.MONGO_URI);
  assert.throws(() => assertLocalSyntheticSeedTarget({
    env: { ...developmentSeedEnv, NODE_ENV: 'production' },
    expectedEnvironment: 'development',
    optInVariable: 'ALLOW_DEMO_SEED',
    databaseName: 'school_management_dev',
  }), /NODE_ENV/);
  assert.throws(() => assertLocalSyntheticSeedTarget({
    env: { ...developmentSeedEnv, ALLOW_DEMO_SEED: undefined },
    expectedEnvironment: 'development',
    optInVariable: 'ALLOW_DEMO_SEED',
    databaseName: 'school_management_dev',
  }), /explicit ALLOW_DEMO_SEED/);
  assert.throws(() => assertLocalSyntheticSeedTarget({
    env: { ...developmentSeedEnv, MONGO_URI: 'mongodb+srv://example.invalid/school_management_dev' },
    expectedEnvironment: 'development',
    optInVariable: 'ALLOW_DEMO_SEED',
    databaseName: 'school_management_dev',
  }), /local MongoDB/);
  assert.throws(() => assertLocalSyntheticSeedTarget({
    env: { ...developmentSeedEnv, MONGO_URI: 'mongodb://127.0.0.1:27017/production' },
    expectedEnvironment: 'development',
    optInVariable: 'ALLOW_DEMO_SEED',
    databaseName: 'school_management_dev',
  }), /isolated school_management_dev/);
  assert.equal(assertLocalSyntheticSeedTarget({
    env: {
      NODE_ENV: 'staging',
      ALLOW_STAGING_DEMO_SEED: '1',
      MONGO_URI: 'mongodb://localhost:27017/school_management_staging',
    },
    expectedEnvironment: 'staging',
    optInVariable: 'ALLOW_STAGING_DEMO_SEED',
    databaseName: 'school_management_staging',
  }), 'mongodb://localhost:27017/school_management_staging');

  let createInput;
  let createCalls = 0;
  stub(User, 'findOne', async () => null);
  stub(User, 'create', async (data) => {
    createCalls += 1;
    createInput = data;
    return data;
  });
  await assert.rejects(
    authService.register({ name: 'Synthetic User', email: 'synthetic@example.test', password: 'ValidPass1', role: 'super_admin', permissions: ['*'] }),
    (error) => error.statusCode === 400
  );
  assert.equal(createCalls, 0, 'privilege-bearing registration must fail before creating a user');
  await authService.register({ name: 'Synthetic User', email: 'synthetic@example.test', password: 'ValidPass1' });
  assert.equal(createInput.role, 'student');
  assert.deepEqual(createInput.permissions, []);

  const parentId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const childId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const outsiderId = 'cccccccccccccccccccccccc';
  stub(Parent, 'findOne', () => queryResult({ _id: parentId, children: [childId] }));
  stub(Student, 'find', () => queryResult([]));
  let existenceFilter;
  stub(Student, 'exists', async (filter) => {
    existenceFilter = filter;
    const parentChildren = filter.$and[0]._id.$in.map(String);
    return parentChildren.includes(String(filter.$and[1]._id)) ? { _id: filter.$and[1]._id } : null;
  });
  await studentAccess.assertStudentAccess({ _id: 'dddddddddddddddddddddddd', role: 'parent' }, childId);
  await assert.rejects(
    studentAccess.assertStudentAccess({ _id: 'dddddddddddddddddddddddd', role: 'parent' }, outsiderId),
    (error) => error.statusCode === 404
  );
  assert.deepEqual(existenceFilter.$and[0]._id.$in, [childId], 'parent access must be bounded by the stored child links');

  stub(Parent, 'findOne', () => queryResult(null));
  await assert.rejects(
    studentService.getAllStudents({}, { _id: 'dddddddddddddddddddddddd', role: 'parent' }),
    (error) => error.statusCode === 404
  );
  stub(Parent, 'findOne', () => queryResult({ _id: parentId, children: [childId] }));
  stub(Student, 'find', () => queryResult([]));

  stub(Faculty, 'findOne', () => queryResult({
    _id: '222222222222222222222222',
    classTeacherOf: { class: '6', academicYear: '2026-2027' },
  }));
  stub(SubjectAllocation, 'find', () => queryResult([{ class: '7', academicYear: '2026-2027' }]));
  const teacherAccess = await studentAccess.getStudentAccess({ _id: '111111111111111111111111', role: 'teacher' });
  assert.deepEqual(teacherAccess.filter.$or, [
    { class: '6', academicYear: '2026-2027' },
    { class: '7', academicYear: '2026-2027' },
  ], 'teacher student access must be limited to assigned classes and academic years');
  stub(Faculty, 'findOne', () => queryResult({ _id: '222222222222222222222222', classTeacherOf: { class: '6' } }));
  stub(SubjectAllocation, 'find', () => queryResult([]));
  const unjournaledTeacherAccess = await studentAccess.getStudentAccess({ _id: '111111111111111111111111', role: 'teacher' });
  assert.deepEqual(unjournaledTeacherAccess.filter, { _id: { $in: [] } }, 'class teacher access without a year must fail closed');

  stub(Parent, 'findById', () => ({
    populate: async () => ({ _id: parentId, user: { _id: '999999999999999999999999' } }),
  }));
  const anotherParent = await parentService.getParentById(parentId, { _id: 'dddddddddddddddddddddddd', role: 'parent' });
  assert.equal(anotherParent, null, 'parent profile lookup must not return another parent by ID');

  const parentOwnerId = 'dddddddddddddddddddddddd';
  let parentOwnershipFilter;
  stub(Parent, 'exists', async (filter) => {
    parentOwnershipFilter = filter;
    return String(filter._id) === parentId && String(filter.user) === parentOwnerId ? { _id: parentId } : null;
  });
  const parentOwnershipGuard = requireOwnership('Parent', 'id');
  const runParentOwnershipGuard = (user, id) => new Promise((resolve) => {
    parentOwnershipGuard({ user, params: { id }, body: {}, query: {} }, {}, (error) => resolve(error || null));
  });
  assert.equal(await runParentOwnershipGuard({ _id: parentOwnerId, role: 'parent' }, parentId), null,
    'a parent may access their own profile');
  assert.deepEqual(parentOwnershipFilter, { _id: parentId, user: parentOwnerId },
    'parent profile routes must query by both profile ID and authenticated owner');
  const profileIdorError = await runParentOwnershipGuard({ _id: outsiderId, role: 'parent' }, parentId);
  assert.equal(profileIdorError.statusCode, 404, 'a parent must not access another parent profile by ID');

  let parentUpdateFilter;
  let parentUpdatePayload;
  stub(Parent, 'findOneAndUpdate', async (filter, update) => {
    parentUpdateFilter = filter;
    parentUpdatePayload = update;
    return { _id: parentId };
  });
  await parentService.updateParent(parentId, {
    occupation: 'Synthetic occupation',
    user: outsiderId,
    children: [outsiderId],
    isActive: false,
  }, { _id: parentOwnerId, role: 'parent' });
  assert.deepEqual(parentUpdateFilter, { _id: parentId, user: parentOwnerId },
    'parent profile updates must remain owner-scoped at the database write');
  assert.deepEqual(parentUpdatePayload, { $set: { occupation: 'Synthetic occupation' } },
    'parent profile updates must not change ownership, child links, or account activation');
  const parentPermissions = getRolePermissions('parent');
  assert.ok(parentPermissions.includes('parents.view-own'));
  assert.ok(parentPermissions.includes('parents.update-own'));
  assert.ok(!parentPermissions.includes('users.update'), 'parents must not receive general user-update permission');
  await assert.rejects(
    parentService.getParentById(parentId, { _id: parentOwnerId, role: 'student' }),
    (error) => error.statusCode === 403
  );
  const ownProfilePermission = requirePermission('parents.view-own');
  let ownProfilePermissionError;
  ownProfilePermission({ user: { _id: parentOwnerId, role: 'parent' } }, {}, (error) => { ownProfilePermissionError = error; });
  assert.equal(ownProfilePermissionError, undefined, 'parent-specific own-profile permission must be accepted');
  const generalUpdatePermission = requirePermission('users.update');
  let generalUpdatePermissionError;
  generalUpdatePermission({ user: { _id: parentOwnerId, role: 'parent' } }, {}, (error) => { generalUpdatePermissionError = error; });
  assert.equal(generalUpdatePermissionError.statusCode, 403, 'parent must not pass general user-update permission');

  let detailFilter;
  stub(Student, 'findOne', (filter) => {
    detailFilter = filter;
    return queryResult({ _id: childId, class: '7' });
  });
  const child = await studentService.getStudentById(childId, { _id: 'dddddddddddddddddddddddd', role: 'parent' });
  assert.equal(child._id, childId);
  assert.equal(detailFilter.$and[0]._id.$in[0], childId);
  assert.equal(detailFilter.$and[1]._id, childId);

  let childListFilter;
  stub(Student, 'find', (filter) => {
    childListFilter = filter;
    return { populate: async () => [{ _id: childId }] };
  });
  const children = await parentService.getChildrenForParent('dddddddddddddddddddddddd');
  assert.deepEqual(children.map((item) => item._id), [childId]);
  assert.deepEqual(childListFilter.$or[0]._id.$in, [childId], 'parent children endpoint must query the Parent.children relation');
  assert.equal(childListFilter.$or[1].parentUser, 'dddddddddddddddddddddddd', 'legacy Student.parentUser links must remain supported');

  let listFilter;
  let countFilter;
  const listQuery = {
    find() { return listQuery; },
    populate() { return listQuery; },
    select() { return listQuery; },
    sort() { return listQuery; },
    skip() { return listQuery; },
    limit() { return listQuery; },
    then(resolve, reject) { return Promise.resolve([]).then(resolve, reject); },
  };
  stub(Student, 'find', (filter) => { listFilter = filter; return listQuery; });
  stub(Student, 'countDocuments', async (filter) => { countFilter = filter; return 1; });
  await studentService.getAllStudents({ page: '1' }, { _id: 'dddddddddddddddddddddddd', role: 'parent' });
  assert.deepEqual(listFilter._id.$in, [childId]);
  assert.deepEqual(countFilter._id.$in, [childId], 'list totals must use the same ownership scope as list records');

  let detailProjection;
  stub(Student, 'findOne', (filter) => {
    detailFilter = filter;
    return {
      select(fields) { detailProjection = fields; return this; },
      populate() { return this; },
      then(resolve, reject) { return Promise.resolve({ _id: childId }).then(resolve, reject); },
    };
  });
  await studentService.getStudentById(childId, { _id: '999999999999999999999999', role: 'accountant' });
  assert.match(detailProjection, /admissionNumber class rollNumber academicYear/);
  assert.doesNotMatch(detailProjection, /medicalConditions|fees|documents/);

  let leaveFilter;
  stub(Leave, 'findOne', (filter) => {
    leaveFilter = filter;
    return { populate: async () => ({ _id: 'eeeeeeeeeeeeeeeeeeeeeeee', user: 'dddddddddddddddddddddddd' }) };
  });
  await leaveService.getLeaveById('eeeeeeeeeeeeeeeeeeeeeeee', { _id: 'dddddddddddddddddddddddd', role: 'teacher' });
  assert.equal(leaveFilter.user, 'dddddddddddddddddddddddd', 'ordinary leave reads must be owner-scoped');
  await assert.rejects(
    leaveService.updateLeaveStatus('eeeeeeeeeeeeeeeeeeeeeeee', 'Approved', { _id: 'ffffffffffffffffffffffff', role: 'teacher' }),
    (error) => error.statusCode === 403
  );

  let createdLeave;
  stub(Leave, 'create', async (data) => { createdLeave = data; return data; });
  stub(Student, 'findOne', () => queryResult({ _id: childId }));
  const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await leaveController.applyLeave({
    user: { _id: 'dddddddddddddddddddddddd', role: 'student' },
    body: { user: 'ffffffffffffffffffffffff', student: 'ffffffffffffffffffffffff', status: 'Approved', approvedBy: 'ffffffffffffffffffffffff', reason: 'Synthetic leave', startDate: '2026-11-20', endDate: '2026-11-21' },
  }, response, (error) => { throw error; });
  assert.equal(createdLeave.user, 'dddddddddddddddddddddddd');
  assert.equal(createdLeave.student, childId);
  assert.equal(createdLeave.status, 'Pending');
  assert.equal(createdLeave.approvedBy, undefined);

  const publishGuard = requireRole('super_admin', 'admin', 'principal', 'exam_coordinator');
  let roleError;
  publishGuard({ user: { role: 'teacher' } }, {}, (error) => { roleError = error; });
  assert.equal(roleError.statusCode, 403, 'teacher cannot pass the publish role gate even with a custom permission');

  let libraryReadCalled = false;
  stub(LibraryTransaction, 'find', () => { libraryReadCalled = true; return { populate: async () => [] }; });
  await assert.rejects(libraryService.getStudentTransactions(outsiderId, { _id: 'dddddddddddddddddddddddd', role: 'parent' }),
    (error) => error.statusCode === 404);
  assert.equal(libraryReadCalled, false, 'unlinked parent must be rejected before library transaction lookup');

  stub(Student, 'findById', () => { throw new Error('unlinked transport record must not be queried'); });
  await assert.rejects(transportService.getStudentTransport(outsiderId, { _id: 'dddddddddddddddddddddddd', role: 'parent' }),
    (error) => error.statusCode === 404);

  const paymentQuery = {
    populate() { return paymentQuery; },
    then(resolve, reject) { return Promise.resolve({ student: outsiderId }).then(resolve, reject); },
  };
  stub(Payment, 'findById', () => paymentQuery);
  await assert.rejects(feeService.getReceipt('777777777777777777777777', { _id: 'dddddddddddddddddddddddd', role: 'parent' }),
    (error) => error.statusCode === 404);

  const teacherId = '111111111111111111111111';
  const facultyId = '222222222222222222222222';
  const subjectId = '333333333333333333333333';
  const marksStudentId = '444444444444444444444444';
  stub(Student, 'findOne', () => queryResult({ _id: marksStudentId, class: '7', academicYear: '2026-2027' }));
  stub(Faculty, 'findOne', () => queryResult({ _id: facultyId }));
  stub(Subject, 'findOne', async () => ({ _id: subjectId, name: 'Mathematics', classLevels: ['7'] }));
  stub(Exam, 'find', () => queryResult([{
    class: '7',
    academicYear: '2026-2027',
    examType: 'Annual',
    isActive: true,
    subjects: [{ subject: 'Math', maxMarks: 100 }],
  }]));
  let assignmentAllowed = true;
  let allocationFilter;
  stub(SubjectAllocation, 'findOne', (filter) => {
    allocationFilter = filter;
    return queryResult(assignmentAllowed ? { _id: '555555555555555555555555' } : null);
  });
  stub(Marks, 'findOne', async () => null);
  const originalSave = Marks.prototype.save;
  Marks.prototype.save = async function saveWithoutDatabase() { this.__savedForUnitTest = true; return this; };
  try {
    const payload = {
      student: marksStudentId,
      class: '7',
      academicYear: '2026-2027',
      examType: 'Annual',
      subjects: [{ subject: 'Math', maxMarks: 100, marksObtained: 91 }],
    };
    await assert.rejects(marksService.addOrUpdateMarks({ ...payload, isPublished: true }, { _id: teacherId, role: 'teacher' }),
      (error) => error.statusCode === 400);
    await assert.rejects(marksService.addOrUpdateMarks({ ...payload, subjects: [{ ...payload.subjects[0], grade: 'forged' }] }, { _id: teacherId, role: 'teacher' }),
      (error) => error.statusCode === 400);
    const saved = await marksService.addOrUpdateMarks(payload, { _id: teacherId, role: 'teacher' });
    assert.equal(saved.created, true);
    assert.equal(saved.record.isPublished, false);
    assert.equal(saved.record.subjects[0].grade, undefined, 'grades are computed by the model rather than accepted from clients');
    assert.equal(allocationFilter.teacher, facultyId);
    assert.equal(allocationFilter.subject, subjectId);
    assert.equal(allocationFilter.class, '7');
    assert.equal(allocationFilter.academicYear, '2026-2027');

    assignmentAllowed = false;
    await assert.rejects(marksService.addOrUpdateMarks(payload, { _id: teacherId, role: 'teacher' }),
      (error) => error.statusCode === 403);
  } finally {
    Marks.prototype.save = originalSave;
  }

  console.log('P0 authorization and seed-guard unit checks passed (no database or external service used).');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(restoreAll);
