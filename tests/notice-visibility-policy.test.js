'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Notice = require('../models/Notice');
const Student = require('../models/Student');
const noticeService = require('../services/notice.service');
const eventService = require('../services/event.service');
const { PERMISSIONS } = require('../config/permissions');
const { hasAnyPermission } = require('../services/audience-scope.service');

const ids = {
  studentUser: 'aaaaaaaaaaaaaaaaaaaaaaaa',
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
    find(filter) { calls.searchFilter = filter; return this; },
    sort(sort) { calls.sort = sort; return this; },
    skip(skip) { calls.skip = skip; return this; },
    limit(limit) { calls.limit = limit; return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

const principal = { _id: 'dddddddddddddddddddddddd', role: 'principal' };
const student = { _id: ids.studentUser, role: 'student' };

function getWindowConditions(filter) {
  const conditions = filter.$and.find(condition =>
    condition.$or?.some(branch => branch.publishDate !== undefined)
  );
  const expiry = filter.$and.find(condition =>
    condition.$or?.some(branch => branch.expiryDate !== undefined)
  );
  return { conditions, expiry };
}

function hasDateBranch(condition, field, predicate) {
  return condition.$or.some(branch => Object.prototype.hasOwnProperty.call(branch, field) && predicate(branch[field]));
}

test('notice.create alone does not bypass recipient filters or management projection', async () => {
  const calls = {};
  const restores = [
    stub(Notice, 'find', filter => { calls.filter = filter; return query([], calls); }),
    stub(Notice, 'countDocuments', async () => 0),
  ];
  try {
    await noticeService.getAllNotices(principal, {});
    const recipientFilter = calls.filter.$and[0];
    assert.equal(recipientFilter.isPublished, true);
    assert.deepEqual(recipientFilter.targetAudience, { $in: ['All'] });
    const dates = getWindowConditions(recipientFilter);
    assert.ok(dates.conditions && dates.expiry);
    assert.match(calls.selection, /publishDate/);
    assert.doesNotMatch(calls.selection, /attachments|createdBy|views|isPublished/);
    assert.equal(calls.population, undefined);
  } finally { restores.reverse().forEach(restore => restore()); }
});

test('only roles with notice update/delete receive explicit management visibility; wildcard remains unchanged', async () => {
  for (const [role, permissions] of Object.entries(PERMISSIONS)) {
    if (role === 'SUPER_ADMIN') {
      assert.deepEqual(permissions, ['*']);
      continue;
    }
    const canEditOrDelete = permissions.includes('notices.update') || permissions.includes('notices.delete');
    assert.equal(permissions.includes('notices.view-management'), canEditOrDelete, role);
  }
  assert.ok(PERMISSIONS.SCHOOL_ADMIN.includes('notices.view-management'));
  assert.ok(PERMISSIONS.PRINCIPAL.includes('notices.create'));
  assert.ok(!PERMISSIONS.PRINCIPAL.includes('notices.view-management'));
  assert.ok(PERMISSIONS.VICE_PRINCIPAL.includes('notices.create'));
  assert.ok(!PERMISSIONS.VICE_PRINCIPAL.includes('notices.view-management'));

  const fixedNow = new Date('2026-11-05T10:00:00.000Z');
  const management = await noticeService.getNoticeReadPolicy({ _id: 'custom', role: 'custom', permissions: ['notices.view-management'] }, fixedNow);
  const wildcard = await noticeService.getNoticeReadPolicy({ _id: 'root', role: 'super_admin' }, fixedNow);
  const creatorOnly = await noticeService.getNoticeReadPolicy(principal, fixedNow);
  const deniedAdmin = await noticeService.getNoticeReadPolicy({
    _id: 'school-admin', role: 'school_admin', permissions: ['-notices.view-management'],
  }, fixedNow);
  assert.equal(management.manager, true);
  assert.deepEqual(management.filter, {});
  assert.equal(hasAnyPermission({ _id: 'custom', role: 'custom', permissions: ['notices.view-management'] }, 'notices.create', 'notices.update', 'notices.delete'), false);
  assert.equal(wildcard.manager, true);
  assert.deepEqual(wildcard.filter, {});
  assert.equal(creatorOnly.manager, false);
  assert.equal(deniedAdmin.manager, false, 'permission override can deny management visibility');
});

test('School Admin and Super Admin management reads bypass recipient publication filters', async () => {
  const calls = { filters: [] };
  const restores = [
    stub(Notice, 'find', filter => { calls.filters.push(filter); return query([], calls); }),
    stub(Notice, 'countDocuments', async () => 0),
    stub(Notice, 'findOneAndUpdate', filter => { calls.detailFilter = filter; return query(null, calls); }),
  ];
  try {
    for (const actor of [
      { _id: 'school-admin', role: 'school_admin' },
      { _id: 'super-admin', role: 'super_admin' },
    ]) {
      calls.filters.length = 0;
      calls.detailFilter = undefined;
      await noticeService.getAllNotices(actor, {});
      await noticeService.getPinnedNotices(actor);
      await noticeService.getNoticesByType('General', actor);
      await assert.rejects(noticeService.getNoticeById(ids.notice, actor), error => error.statusCode === 404);
      assert.equal(calls.filters.length, 3);
      assert.ok(calls.filters.every(filter => Object.keys(filter.$and[0]).length === 0));
      assert.deepEqual(calls.detailFilter, { _id: ids.notice });
      assert.match(calls.selection, /isPublished/);
      assert.deepEqual(calls.population, ['createdBy', 'name role']);
    }
  } finally { restores.reverse().forEach(restore => restore()); }
});

test('recipient publication window uses inclusive Date bounds and allows missing/null dates', async () => {
  const fixedNow = new Date('2026-11-05T10:00:00.000Z');
  // Principal resolves to the default recipient audience without querying a linked record.
  const policy = await noticeService.getNoticeReadPolicy(principal, fixedNow);
  const { conditions: publishCondition, expiry: expiryCondition } = getWindowConditions(policy.filter);
  assert.ok(publishCondition);
  assert.ok(expiryCondition);
  assert.equal(policy.filter.isPublished, true);
  assert.ok(hasDateBranch(publishCondition, 'publishDate', value => value.$exists === false));
  assert.ok(hasDateBranch(publishCondition, 'publishDate', value => value === null));
  assert.ok(hasDateBranch(publishCondition, 'publishDate', value => value && value.$lte instanceof Date && value.$lte.getTime() === fixedNow.getTime()));
  assert.ok(hasDateBranch(expiryCondition, 'expiryDate', value => value.$exists === false));
  assert.ok(hasDateBranch(expiryCondition, 'expiryDate', value => value === null));
  assert.ok(hasDateBranch(expiryCondition, 'expiryDate', value => value && value.$gte instanceof Date && value.$gte.getTime() === fixedNow.getTime()));

  const publishBound = publishCondition.$or.find(branch => branch.publishDate?.$lte)?.publishDate.$lte;
  const expiryBound = expiryCondition.$or.find(branch => branch.expiryDate?.$gte)?.expiryDate.$gte;
  assert.ok(new Date(fixedNow.getTime() + 1).getTime() > publishBound.getTime(), 'future publish time is outside the allowed bound');
  assert.ok(new Date(fixedNow.getTime() - 1).getTime() < expiryBound.getTime(), 'expired time is outside the allowed bound');
  assert.equal(fixedNow.getTime(), publishBound.getTime(), 'publish equality is included by $lte');
  assert.equal(fixedNow.getTime(), expiryBound.getTime(), 'expiry equality is included by $gte');
});

test('list, pinned, type, and direct detail share recipient publication, audience, and class filters', async () => {
  const calls = { listFilters: [] };
  const restores = [
    stub(Student, 'findOne', () => query({ class: '6' })),
    stub(Notice, 'find', filter => { calls.listFilters.push(filter); return query([], calls); }),
    stub(Notice, 'countDocuments', async () => 0),
    stub(Notice, 'findOneAndUpdate', filter => { calls.detailFilter = filter; return query(null, calls); }),
  ];
  try {
    await noticeService.getAllNotices(student, {});
    await noticeService.getPinnedNotices(student);
    await noticeService.getNoticesByType('General', student);
    await assert.rejects(noticeService.getNoticeById(ids.notice, student), error => error.statusCode === 404);

    assert.equal(calls.listFilters.length, 3);
    const policies = calls.listFilters.map(filter => filter.$and[0]);
    policies.push(calls.detailFilter.$and[0]);
    const canonical = policies[0];
    for (const policy of policies.slice(1)) {
      assert.equal(policy.isPublished, true);
      assert.deepEqual(policy.targetAudience, canonical.targetAudience);
      assert.deepEqual(policy.$or, canonical.$or);
      assert.deepEqual(policy.$and.map(item => Object.keys(item.$or[0])[0]), ['publishDate', 'expiryDate']);
      const operators = policy.$and.map(item => {
        const field = Object.keys(item.$or[0])[0];
        const bound = item.$or.find(branch => branch[field] && ['$lte', '$gte'].some(operator => operator in branch[field]));
        const operator = ['$lte', '$gte'].find(candidate => candidate in bound[field]);
        return { field, operator, valueIsDate: bound[field][operator] instanceof Date };
      });
      assert.deepEqual(operators, [
        { field: 'publishDate', operator: '$lte', valueIsDate: true },
        { field: 'expiryDate', operator: '$gte', valueIsDate: true },
      ]);
    }
    assert.deepEqual(canonical.targetAudience, { $in: ['Students', 'All'] });
    assert.ok(canonical.$or.some(branch => branch.targetClasses?.$in?.includes('6')));
  } finally { restores.reverse().forEach(restore => restore()); }
});

test('protected event role permissions remain unchanged for Teachers and Principals', async () => {
  for (const role of ['teacher', 'class_teacher', 'principal', 'vice_principal']) {
    assert.ok(!PERMISSIONS[role.toUpperCase()].includes('events.view'), role);
    const actor = { _id: `user-${role}`, role };
    await assert.rejects(eventService.getUpcomingEvents(actor), error => error.statusCode === 403);
    await assert.rejects(eventService.getAllEvents(actor), error => error.statusCode === 403);
    await assert.rejects(eventService.getEventById(ids.event, actor), error => error.statusCode === 403);
  }
  assert.ok(PERMISSIONS.STUDENT.includes('events.view'));
  assert.ok(PERMISSIONS.PARENT.includes('events.view'));
  assert.ok(PERMISSIONS.STAFF.includes('events.view'));
});
