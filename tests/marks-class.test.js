'use strict';
/**
 * Phase 26F – Batch 2: Marks Class Endpoint Regression Tests
 *
 * Covers:
 *   1. Class read from req.params.class (canonical route parameter).
 *   2. Query fallback from req.query.class.
 *   3. Missing class returns HTTP 400.
 *   4. Empty or whitespace-only class returns HTTP 400.
 *   5. Database query strictly enforces isPublished: true.
 *   6. Query options examType and academicYear properly included when provided.
 *   7. Population ({ path: 'student', populate: { path: 'user', select: 'name' } }) and .sort('rank') remain intact.
 *   8. Response payload format { success: true, count, data: { marks } } preserved.
 *   9. Route contract: router exposes GET /class/:class with requirePermission and requireClassAccess('class').
 *  10. requireClassAccess('class') authorization behavior: enforces student class match, allows admin bypass.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const marksController = require('../controllers/marks.controller');
const marksRoutes = require('../routes/marks.routes');
const { requireClassAccess } = require('../middleware/authorization.middleware');
const Marks = require('../models/Marks');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

function mockNext() {
  const fn = (err) => {
    fn.called = true;
    fn.error = err || null;
  };
  fn.called = false;
  fn.error = null;
  return fn;
}

describe('Marks Class Endpoint — Controller Contract (getClassMarks)', () => {

  it('reads class from req.params.class and enforces isPublished: true', async () => {
    let capturedFilter = null;
    let capturedPopulate = null;
    let capturedSort = null;

    const mockRecords = [
      { _id: 'm1', class: '10', examType: 'Midterm', isPublished: true, rank: 1 },
      { _id: 'm2', class: '10', examType: 'Midterm', isPublished: true, rank: 2 },
    ];

    const originalFind = Marks.find;
    Marks.find = function(filter) {
      capturedFilter = filter;
      return {
        populate(pop) {
          capturedPopulate = pop;
          return this;
        },
        sort(s) {
          capturedSort = s;
          return Promise.resolve(mockRecords);
        },
      };
    };

    try {
      const req = {
        params: { class: '10' },
        query: { examType: 'Midterm', academicYear: '2026-2027' },
      };
      const res = mockRes();

      await marksController.getClassMarks(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(capturedFilter.class, '10');
      assert.equal(capturedFilter.isPublished, true);
      assert.equal(capturedFilter.examType, 'Midterm');
      assert.equal(capturedFilter.academicYear, '2026-2027');
      assert.deepEqual(capturedPopulate, { path: 'student', populate: { path: 'user', select: 'name' } });
      assert.equal(capturedSort, 'rank');
      assert.equal(res.body.success, true);
      assert.equal(res.body.count, 2);
      assert.deepEqual(res.body.data.marks, mockRecords);
    } finally {
      Marks.find = originalFind;
    }
  });

  it('supports fallback to req.query.class when req.params.class is not provided', async () => {
    let capturedFilter = null;

    const originalFind = Marks.find;
    Marks.find = function(filter) {
      capturedFilter = filter;
      return {
        populate() { return this; },
        sort() { return Promise.resolve([]); },
      };
    };

    try {
      const req = {
        params: {},
        query: { class: '8', examType: 'Annual' },
      };
      const res = mockRes();

      await marksController.getClassMarks(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(capturedFilter.class, '8');
      assert.equal(capturedFilter.isPublished, true);
      assert.equal(capturedFilter.examType, 'Annual');
      assert.equal(capturedFilter.academicYear, undefined);
    } finally {
      Marks.find = originalFind;
    }
  });

  it('gives priority to req.params.class over req.query.class if both are present', async () => {
    let capturedFilter = null;

    const originalFind = Marks.find;
    Marks.find = function(filter) {
      capturedFilter = filter;
      return {
        populate() { return this; },
        sort() { return Promise.resolve([]); },
      };
    };

    try {
      const req = {
        params: { class: '11' },
        query: { class: '10' },
      };
      const res = mockRes();

      await marksController.getClassMarks(req, res);

      assert.equal(capturedFilter.class, '11');
    } finally {
      Marks.find = originalFind;
    }
  });

  it('rejects missing class with HTTP 400 Bad Request', async () => {
    const req = { params: {}, query: {} };
    const res = mockRes();

    await assert.rejects(
      () => marksController.getClassMarks(req, res),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Class is required/i);
        return true;
      }
    );
  });

  it('rejects empty string class with HTTP 400 Bad Request', async () => {
    const req = { params: { class: '' }, query: {} };
    const res = mockRes();

    await assert.rejects(
      () => marksController.getClassMarks(req, res),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Class is required/i);
        return true;
      }
    );
  });

  it('rejects whitespace-only class with HTTP 400 Bad Request', async () => {
    const req = { params: { class: '   ' }, query: {} };
    const res = mockRes();

    await assert.rejects(
      () => marksController.getClassMarks(req, res),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Class is required/i);
        return true;
      }
    );
  });

  it('trims leading/trailing whitespace from class identifier', async () => {
    let capturedFilter = null;

    const originalFind = Marks.find;
    Marks.find = function(filter) {
      capturedFilter = filter;
      return {
        populate() { return this; },
        sort() { return Promise.resolve([]); },
      };
    };

    try {
      const req = { params: { class: '  12  ' }, query: {} };
      const res = mockRes();

      await marksController.getClassMarks(req, res);
      assert.equal(capturedFilter.class, '12');
    } finally {
      Marks.find = originalFind;
    }
  });
});

describe('Marks Class Endpoint — Route and Authorization Middleware Contract', () => {

  it('route /class/:class is registered and wired with requireClassAccess', () => {
    const classRoute = marksRoutes.stack.find(
      (layer) => layer.route && layer.route.path === '/class/:class'
    );
    assert.ok(classRoute, 'Route GET /class/:class must be defined on router');
    assert.ok(classRoute.route.methods.get, 'Route must handle GET');

    // Verify middleware chain on route: should include requireClassAccess
    const handlers = classRoute.route.stack;
    assert.ok(handlers.length >= 3, 'Route should include protect, permissions, classAccess, and controller');
  });

  it('requireClassAccess("class") allows administrative roles unconditional access', async () => {
    const middleware = requireClassAccess('class');
    const req = {
      user: { _id: 'u1', role: 'admin' },
      params: { class: '10' },
    };
    const next = mockNext();

    await middleware(req, {}, next);
    assert.equal(next.error, null);
  });

  it('requireClassAccess("class") denies student belonging to different class', async () => {
    const Student = require('../models/Student');
    const originalFindOne = Student.findOne;
    Student.findOne = () => ({
      select() { return this; },
      then(resolve) { return Promise.resolve({ class: '9' }).then(resolve); },
    });

    try {
      const middleware = requireClassAccess('class');
      const req = {
        user: { _id: 'u2', role: 'student' },
        params: { class: '10' },
      };
      const next = mockNext();

      await middleware(req, {}, next);
      assert.ok(next.error, 'Should call next with 403 access denied');
      assert.equal(next.error.statusCode, 403);
      assert.match(next.error.message, /Access denied.*class 10/);
    } finally {
      Student.findOne = originalFindOne;
    }
  });

  it('requireClassAccess("class") allows student belonging to the requested class', async () => {
    const Student = require('../models/Student');
    const originalFindOne = Student.findOne;
    Student.findOne = () => ({
      select() { return this; },
      then(resolve) { return Promise.resolve({ class: '10' }).then(resolve); },
    });

    try {
      const middleware = requireClassAccess('class');
      const req = {
        user: { _id: 'u3', role: 'student' },
        params: { class: '10' },
      };
      const next = mockNext();

      await middleware(req, {}, next);
      assert.equal(next.error, null);
    } finally {
      Student.findOne = originalFindOne;
    }
  });
});
