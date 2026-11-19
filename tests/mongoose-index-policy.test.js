'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Class = require('../models/Class');
const Exam = require('../models/Exam');
const examService = require('../services/exam.service');
const {
  assertDeclaredIndexesPresent,
  ensureIndexReady,
  indexMatches,
  prepareModelIndexes,
} = require('../utils/mongoose-index-policy');

async function withNodeEnv(value, callback) {
  const hadValue = Object.prototype.hasOwnProperty.call(process.env, 'NODE_ENV');
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await callback();
  } finally {
    if (hadValue) process.env.NODE_ENV = previous;
    else delete process.env.NODE_ENV;
  }
}

function fakeModel({ definitions = [], indexes = [] } = {}) {
  const calls = { list: 0, createIndexes: 0, createIndex: 0 };
  return {
    modelName: 'SyntheticModel',
    schema: { indexes: () => definitions },
    async listIndexes() { calls.list += 1; return indexes; },
    async createIndexes() { calls.createIndexes += 1; return 'created'; },
    collection: {
      async createIndex() { calls.createIndex += 1; return 'created'; },
    },
    calls,
  };
}

async function withStubs(stubs, callback) {
  const originals = stubs.map(([target, key, replacement]) => {
    const hadOwn = Object.prototype.hasOwnProperty.call(target, key);
    const original = target[key];
    target[key] = replacement;
    return { target, key, hadOwn, original };
  });
  try {
    return await callback();
  } finally {
    for (const { target, key, hadOwn, original } of originals.reverse()) {
      if (hadOwn) target[key] = original;
      else delete target[key];
    }
  }
}

test('production model preparation verifies declared indexes without creating them', async () => {
  await withNodeEnv('production', async () => {
    const definition = [{ student: 1, academicYear: 1 }, { unique: true, sparse: true }];
    const model = fakeModel({
      definitions: [definition],
      indexes: [{ key: definition[0], name: 'generated_name', v: 2, ...definition[1] }],
    });

    await prepareModelIndexes(model);

    assert.equal(model.calls.list, 1);
    assert.equal(model.calls.createIndexes, 0);
  });
});

test('production model preparation fails closed when a declared index is missing or differs', async () => {
  await withNodeEnv('production', async () => {
    const definition = [{ class: 1, academicYear: 1, examType: 1 }, { unique: true }];
    const model = fakeModel({
      definitions: [definition],
      indexes: [{ key: definition[0], name: 'wrong_unique_state', unique: false }],
    });

    await assert.rejects(prepareModelIndexes(model), error => error.statusCode === 503);
    assert.equal(model.calls.createIndexes, 0);
  });
});

test('production index preflight fails closed when model declarations are absent', async () => {
  await withNodeEnv('production', async () => {
    await assert.rejects(assertDeclaredIndexesPresent([]), error => error.statusCode === 503);
    await assert.rejects(prepareModelIndexes({ modelName: 'MalformedModel' }), error => error.statusCode === 503);
  });
});

test('startup verification preserves both unique constraints and non-unique lookup indexes', async () => {
  await withNodeEnv('production', async () => {
    const unique = [{ email: 1 }, { unique: true }];
    const nonUnique = [{ status: 1, createdAt: 1 }, {}];
    const model = fakeModel({
      definitions: [unique, nonUnique],
      indexes: [
        { key: unique[0], name: 'email_1', unique: true },
        { key: nonUnique[0], name: 'status_1_createdAt_1' },
      ],
    });

    await assertDeclaredIndexesPresent([model]);

    assert.equal(model.calls.list, 1);
    assert.equal(model.calls.createIndexes, 0);
  });
});

test('production index readiness requires exact key order and semantic options', async () => {
  assert.equal(indexMatches(
    { key: { class: 1, academicYear: 1 }, name: 'class_1_academicYear_1', v: 2, unique: true },
    { class: 1, academicYear: 1 },
    { unique: true },
  ), true);
  assert.equal(indexMatches(
    { key: { academicYear: 1, class: 1 }, unique: true },
    { class: 1, academicYear: 1 },
    { unique: true },
  ), false);
  assert.equal(indexMatches(
    { key: { class: 1, academicYear: 1 }, unique: false },
    { class: 1, academicYear: 1 },
    { unique: true },
  ), false);
});

test('development preparation preserves explicit index creation behavior', async () => {
  await withNodeEnv('development', async () => {
    const model = fakeModel();
    await prepareModelIndexes(model);
    assert.equal(model.calls.createIndexes, 1);
  });
});

test('production explicit index readiness never calls collection createIndex', async () => {
  await withNodeEnv('production', async () => {
    const model = fakeModel({
      indexes: [{ key: { idempotencyKey: 1 }, unique: true, sparse: true }],
    });
    await ensureIndexReady(model, { idempotencyKey: 1 }, { unique: true, sparse: true });
    assert.equal(model.calls.createIndex, 0);
    assert.equal(model.calls.list, 1);
  });
});

test('production exam creation stops before duplicate lookup or write when its unique index is missing', async () => {
  await withNodeEnv('production', async () => {
    const calls = { duplicateLookup: 0, write: 0 };
    await withStubs([
      [Class, 'findOne', async () => ({ _id: 'synthetic-class' })],
      [Exam, 'listIndexes', async () => []],
      [Exam, 'exists', async () => { calls.duplicateLookup += 1; return false; }],
      [Exam, 'create', async () => { calls.write += 1; return {}; }],
    ], async () => {
      await assert.rejects(examService.createExam({
        name: 'Synthetic exam',
        examType: 'Unit Test',
        class: '6',
        academicYear: '2025-2026',
        subjects: [{ subject: 'Mathematics', maxMarks: 100 }],
      }, 'synthetic-user'), error => error.statusCode === 503);
    });

    assert.deepEqual(calls, { duplicateLookup: 0, write: 0 });
  });
});
