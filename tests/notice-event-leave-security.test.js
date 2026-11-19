'use strict';

// Avoid implicit dotenv loading when the route imports auth middleware.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const Notice = require('../models/Notice');
const Event = require('../models/Event');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const Faculty = require('../models/Faculty');
const User = require('../models/User');
const noticeService = require('../services/notice.service');
const eventService = require('../services/event.service');
const facultyLeaveService = require('../services/faculty-leave.service');
const facultyController = require('../controllers/faculty.controller');

const ids = {
  studentUser: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  parentUser: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  teacherUser: 'cccccccccccccccccccccccc',
  approver: 'dddddddddddddddddddddddd',
  faculty: 'eeeeeeeeeeeeeeeeeeeeeeee',
  leave: 'ffffffffffffffffffffffff',
  notice: '111111111111111111111111',
  event: '222222222222222222222222',
};

function stub(target, key, replacement) {
  const original = target[key];
  target[key] = replacement;
  return () => { target[key] = original; };
}

function query(value, calls = {}) {
  return {
    select(selection) { calls.selection = selection; return this; },
    populate(...args) { calls.population = args; return this; },
    sort(sort) { calls.sort = sort; return this; },
    skip(skip) { calls.skip = skip; return this; },
    limit(limit) { calls.limit = limit; return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

const teacher = { _id: ids.teacherUser, role: 'teacher' };
const student = { _id: ids.studentUser, role: 'student' };
const principal = { _id: ids.approver, role: 'principal' };

test('notice list and detail both enforce publication, audience, and student class scope', async () => {
  const calls = {};
  const restores = [
    stub(Student, 'findOne', filter => {
      calls.studentIdentityFilter = filter;
      return query({ _id: '333333333333333333333333', class: '6' });
    }),
    stub(Notice, 'find', filter => { calls.listFilter = filter; return query([], calls); }),
    stub(Notice, 'countDocuments', async filter => { calls.countFilter = filter; return 0; }),
    stub(Notice, 'findOneAndUpdate', (filter, update) => {
      calls.detailFilter = filter;
      calls.detailUpdate = update;
      return query(null, calls);
    }),
  ];
  try {
    await noticeService.getAllNotices(student, {});
    assert.deepEqual(calls.studentIdentityFilter, { user: ids.studentUser, isActive: true });
    assert.equal(calls.listFilter.$and[0].isPublished, true);
    assert.deepEqual(calls.listFilter.$and[0].targetAudience, { $in: ['Students', 'All'] });
    assert.doesNotMatch(calls.selection, /attachments|createdBy|views|viewedBy/);
    assert.ok(calls.listFilter.$and[0].$or.some(branch => branch.targetClasses?.$in?.includes('6')));
    assert.deepEqual(calls.countFilter, calls.listFilter);

    await assert.rejects(noticeService.getNoticeById(ids.notice, student), error => error.statusCode === 404);
    assert.equal(calls.detailFilter.$and[0].isPublished, true);
    assert.deepEqual(calls.detailFilter.$and[0].targetAudience, { $in: ['Students', 'All'] });
    assert.deepEqual(calls.detailUpdate, { $inc: { views: 1 }, $addToSet: { viewedBy: { user: ids.studentUser } } });
  } finally { restores.reverse().forEach(restore => restore()); }
});

test('unpublished notice detail is not returned even when audience and class otherwise match', async () => {
  const restores = [
    stub(Student, 'findOne', () => query({ class: '6' })),
    stub(Notice, 'findOneAndUpdate', filter => {
      assert.equal(filter.$and[0].isPublished, true);
      return query(null);
    }),
  ];
  try {
    await assert.rejects(noticeService.getNoticeById(ids.notice, student), error => error.statusCode === 404);
  } finally { restores.reverse().forEach(restore => restore()); }
});

test('parent notice scope includes classes from both linked children and legacy parentUser records', async () => {
  const calls = {};
  const restores = [
    stub(Parent, 'findOne', filter => {
      calls.parentFilter = filter;
      return query({ children: ['444444444444444444444444'], isActive: true });
    }),
    stub(Student, 'find', filter => {
      calls.childFilter = filter;
      return query([{ class: '4' }, { class: '8' }]);
    }),
    stub(Notice, 'find', filter => { calls.noticeFilter = filter; return query([]); }),
    stub(Notice, 'countDocuments', async () => 0),
  ];
  try {
    await noticeService.getAllNotices({ _id: ids.parentUser, role: 'parent' }, {});
    assert.deepEqual(calls.parentFilter, { user: ids.parentUser, isActive: true });
    assert.ok(calls.childFilter.$or.some(branch => branch.parentUser === ids.parentUser));
    assert.ok(calls.childFilter.$or.some(branch => branch._id.$in.includes('444444444444444444444444')));
    assert.deepEqual(calls.noticeFilter.$and[0].targetAudience, { $in: ['Parents', 'All'] });
    assert.ok(calls.noticeFilter.$and[0].$or.some(branch => branch.targetClasses?.$in?.includes('4')));
    assert.ok(calls.noticeFilter.$and[0].$or.some(branch => branch.targetClasses?.$in?.includes('8')));
  } finally { restores.reverse().forEach(restore => restore()); }
});

test('notice creation requires an explicit audience and fixes publication/creator fields server-side', async () => {
  let created;
  const restore = stub(Notice, 'create', async data => { created = data; return data; });
  try {
    await assert.rejects(noticeService.createNotice({ title: 'Test', content: 'Body' }, principal), error => error.statusCode === 400);
    await noticeService.createNotice({ title: 'Test', content: 'Body', targetAudience: ['Students'], isPublished: false }, principal)
      .then(() => assert.fail('client publication override should be rejected'))
      .catch(error => assert.equal(error.statusCode, 400));
    await noticeService.createNotice({ title: 'Test', content: 'Body', targetAudience: ['Students'] }, principal);
    assert.equal(created.createdBy, ids.approver);
    assert.equal(created.isPublished, true);
    assert.deepEqual(created.targetAudience, ['Students']);
  } finally { restore(); }
});

test('public event list uses published/audience/class filters and the schema startDate field', async () => {
  const calls = {};
  const restores = [
    stub(Student, 'findOne', () => query({ class: '6' })),
    stub(Event, 'find', filter => { calls.filter = filter; return query([]); }),
  ];
  try {
    await eventService.getPublicEvents(student);
    assert.equal(calls.filter.isPublic, true);
    assert.equal(calls.filter.isActive, true);
    assert.ok(calls.filter.startDate.$gte instanceof Date);
    assert.deepEqual(calls.filter.targetAudience, { $in: ['Students', 'All'] });
    assert.ok(calls.filter.$or.some(branch => branch.targetClasses?.$in?.includes('6')));
  } finally { restores.reverse().forEach(restore => restore()); }
});

test('event direct-ID lookup applies the same audience and class policy as event lists', async () => {
  const calls = {};
  const restores = [
    stub(Student, 'findOne', () => query({ class: '6' })),
    stub(Event, 'findOne', filter => { calls.detailFilter = filter; return null; }),
  ];
  try {
    await assert.rejects(eventService.getEventById(ids.event, student), error => error.statusCode === 404);
    const visibility = calls.detailFilter.$and[0];
    assert.equal(visibility.isPublic, true);
    assert.equal(visibility.isActive, true);
    assert.deepEqual(visibility.targetAudience, { $in: ['Students', 'All'] });
    assert.ok(visibility.$or.some(branch => branch.targetClasses?.$in?.includes('6')));
  } finally { restores.reverse().forEach(restore => restore()); }
});

test('unsupported authenticated roles cannot use protected event reads without events.view', async () => {
  await assert.rejects(eventService.getAllEvents(teacher), error => error.statusCode === 403);
});

test('faculty leave creation rejects approval fields and binds the request to the authenticated faculty user', async () => {
  const calls = {};
  const leave = { _id: ids.leave, status: 'Pending', type: 'Sick' };
  const facultyDoc = { leaves: [leave] };
  const restore = stub(Faculty, 'findOneAndUpdate', async (filter, update, options) => {
    calls.filter = filter;
    calls.update = update;
    calls.options = options;
    return facultyDoc;
  });
  try {
    await assert.rejects(facultyLeaveService.applyFacultyLeave(ids.faculty, teacher, {
      type: 'Sick', from: '2026-11-10', to: '2026-11-11', reason: 'Ill', status: 'Approved', approvedBy: ids.approver,
    }), error => error.statusCode === 400);
    await assert.rejects(facultyLeaveService.applyFacultyLeave(ids.faculty, teacher, {
      type: 'Sick', from: null, to: '2026-11-11', reason: 'Ill',
    }), error => error.statusCode === 400);
    const created = await facultyLeaveService.applyFacultyLeave(ids.faculty, teacher, {
      type: 'Sick', from: '2026-11-10', to: '2026-11-11', reason: 'Ill',
    });
    assert.equal(created, leave);
    assert.deepEqual(calls.filter, { _id: ids.faculty, user: ids.teacherUser, isActive: true });
    assert.equal(calls.update.$push.leaves.status, 'Pending');
    assert.equal(calls.update.$push.leaves.approvedBy, undefined);
    assert.equal(calls.options.runValidators, true);
  } finally { restore(); }
});

test('faculty leave approval is permission-specific, pending-only, and attributes the authenticated approver', async () => {
  const calls = {};
  const leave = { _id: ids.leave, status: 'Approved', approvedBy: ids.approver };
  const facultyDoc = { leaves: { id: () => leave } };
  const restore = stub(Faculty, 'findOneAndUpdate', async (filter, update) => {
    calls.filter = filter;
    calls.update = update;
    return facultyDoc;
  });
  try {
    await assert.rejects(facultyLeaveService.updateFacultyLeaveStatus(ids.faculty, ids.leave, 'Approved', teacher), error => error.statusCode === 403);
    await assert.rejects(facultyLeaveService.updateFacultyLeaveStatus(ids.faculty, ids.leave, 'Rejected', teacher), error => error.statusCode === 403);
    const updated = await facultyLeaveService.updateFacultyLeaveStatus(ids.faculty, ids.leave, 'Approved', principal);
    assert.equal(updated, leave);
    assert.deepEqual(calls.filter, { _id: ids.faculty, leaves: { $elemMatch: { _id: ids.leave, status: 'Pending' } } });
    assert.equal(calls.update.$set['leaves.$.status'], 'Approved');
    assert.equal(calls.update.$set['leaves.$.approvedBy'], ids.approver);
  } finally { restore(); }
});

test('generic Faculty create/update cannot write embedded leave approval records', async () => {
  let userReads = 0;
  let facultyReads = 0;
  const restoreUser = stub(User, 'findOne', async () => { userReads += 1; return null; });
  const restoreFaculty = stub(Faculty, 'findById', async () => { facultyReads += 1; return null; });
  try {
    // createFaculty is now retired (returns 410); verify it makes no DB reads regardless of injected body
    let statusSent;
    const mockRes = { status(code) { statusSent = code; return this; }, json() { return this; } };
    await facultyController.createFaculty({ body: {
      name: 'Example', email: 'example@school.test', password: 'safe-test-pass',
      $set: { 'leaves.0.status': 'Approved' },
    } }, mockRes);
    assert.equal(statusSent, 410, 'createFaculty must return 410 (deprecated)');
    assert.equal(userReads, 0, 'createFaculty must not query User');
    await assert.rejects(facultyController.updateFaculty({ params: { id: ids.faculty }, body: { leaves: [{ status: 'Approved' }] } }, {}), error => error.statusCode === 400);
    await assert.rejects(facultyController.updateFaculty({ params: { id: ids.faculty }, body: { $rename: { legacyNotes: 'leaves' } } }, {}), error => error.statusCode === 400);
    assert.equal(facultyReads, 0);
  } finally { restoreFaculty(); restoreUser(); }
});

test('faculty leave HTTP route uses leave.apply and approval/rejection permission gates', async () => {
  const router = require('../routes/faculty.routes');
  const postLayer = router.stack.find(layer => layer.route && layer.route.path === '/:id/leave' && layer.route.methods.post);
  const putLayer = router.stack.find(layer => layer.route && layer.route.path === '/:id/leave/:leaveId' && layer.route.methods.put);
  assert.ok(postLayer);
  assert.ok(putLayer);
  const postGate = postLayer.route.stack[0].handle;
  const putGate = putLayer.route.stack[0].handle;
  const invoke = (middleware, user) => new Promise(resolve => middleware({ user }, {}, error => resolve(error || null)));
  assert.equal(await invoke(postGate, teacher), null);
  assert.equal((await invoke(postGate, { _id: ids.studentUser, role: 'student' })).statusCode, 403);
  assert.equal((await invoke(putGate, teacher)).statusCode, 403);
  assert.equal(await invoke(putGate, principal), null);
});
