'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const Notice = require('../models/Notice');
const noticeController = require('../controllers/notice.controller');
const { PERMISSIONS } = require('../config/permissions');

function stub(target, key, replacement) {
  const original = target[key];
  target[key] = replacement;
  return () => { target[key] = original; };
}

// The auth middleware imports config/env. Replace only that import while loading
// the route so the test can inspect its actual permission middleware safely.
const routePath = require.resolve('../routes/notice.routes');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === routePath && request === '../middleware/auth.middleware') {
    return {
      protect: (_req, _res, next) => next(),
      optionalProtect: (_req, _res, next) => next(),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
let noticeRouter;
try {
  noticeRouter = require(routePath);
} finally {
  Module._load = originalLoad;
}

const ids = { notice: '111111111111111111111111' };
const updateOnly = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'staff', permissions: ['notices.update'] };
const managementOnly = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', role: 'staff', permissions: ['notices.view-management'] };
const schoolAdmin = { _id: 'cccccccccccccccccccccccc', role: 'school_admin' };
const superAdmin = { _id: 'dddddddddddddddddddddddd', role: 'super_admin' };

function route(path, method) {
  return noticeRouter.stack.find(layer => layer.route && layer.route.path === path && layer.route.methods[method]);
}

function invokeMiddleware(middleware, user) {
  return new Promise(resolve => middleware({ user }, {}, error => resolve(error || null)));
}

test('pin route requires both update and management visibility permissions', async () => {
  const pinRoute = route('/:id/pin', 'put');
  assert.ok(pinRoute);
  assert.equal(pinRoute.route.stack.length, 2);
  assert.equal(pinRoute.route.stack[1].handle, noticeController.togglePin);
  const gate = pinRoute.route.stack[0].handle;
  assert.equal((await invokeMiddleware(gate, updateOnly)).statusCode, 403);
  assert.equal((await invokeMiddleware(gate, managementOnly)).statusCode, 403);
  assert.equal(await invokeMiddleware(gate, schoolAdmin), null);
  assert.equal(await invokeMiddleware(gate, superAdmin), null);
});

test('update-only caller cannot reach pin controller or retrieve/mutate a notice directly', async () => {
  let reads = 0;
  let saves = 0;
  const notice = { isPinned: false, save: async () => { saves += 1; } };
  const restore = stub(Notice, 'findById', async () => {
    reads += 1;
    return notice;
  });
  try {
    for (const actor of [updateOnly, managementOnly]) {
      const response = { status() { throw new Error('unauthorized request must not write a response'); } };
      await assert.rejects(
        noticeController.togglePin({ params: { id: ids.notice }, user: actor }, response),
        error => error.statusCode === 403
      );
      if (actor === updateOnly) assert.equal(notice.isPinned, false);
      else assert.equal(notice.isPinned, true);
      notice.isPinned = true;
    }
    assert.equal(reads, 0);
    assert.equal(saves, 0);
  } finally { restore(); }
});

test('School Admin with both permissions and Super Admin wildcard can pin through the controller', async () => {
  for (const actor of [schoolAdmin, superAdmin]) {
    let saves = 0;
    const notice = { isPinned: false, save: async () => { saves += 1; } };
    const restore = stub(Notice, 'findById', async id => {
      assert.equal(id, ids.notice);
      return notice;
    });
    const response = {
      code: null,
      body: null,
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    try {
      await noticeController.togglePin({ params: { id: ids.notice }, user: actor }, response);
      assert.equal(notice.isPinned, true);
      assert.equal(saves, 1);
      assert.equal(response.code, 200);
      assert.equal(response.body.data.notice, notice);

      const unpinResponse = {
        code: null,
        body: null,
        status(code) { this.code = code; return this; },
        json(body) { this.body = body; return this; },
      };
      await noticeController.togglePin({ params: { id: ids.notice }, user: actor }, unpinResponse);
      assert.equal(notice.isPinned, false);
      assert.equal(saves, 2);
      assert.equal(unpinResponse.body.message, 'Notice unpinned');
    } finally { restore(); }
  }
});

test('pin fix preserves ordinary update/delete route permissions and role grants', async () => {
  const updateRoute = route('/:id', 'put');
  const deleteRoute = route('/:id', 'delete');
  assert.ok(updateRoute);
  assert.ok(deleteRoute);
  assert.equal(await invokeMiddleware(updateRoute.route.stack[0].handle, updateOnly), null);
  assert.equal((await invokeMiddleware(updateRoute.route.stack[0].handle, managementOnly)).statusCode, 403);
  assert.equal((await invokeMiddleware(deleteRoute.route.stack[0].handle, updateOnly)).statusCode, 403);
  assert.equal(await invokeMiddleware(deleteRoute.route.stack[0].handle, schoolAdmin), null);
  assert.ok(PERMISSIONS.SCHOOL_ADMIN.includes('notices.update'));
  assert.ok(PERMISSIONS.SCHOOL_ADMIN.includes('notices.delete'));
  assert.ok(!PERMISSIONS.PRINCIPAL.includes('notices.view-management'));
  assert.ok(!PERMISSIONS.VICE_PRINCIPAL.includes('notices.view-management'));
  assert.equal(deleteRoute.route.stack.length, 2);
});
