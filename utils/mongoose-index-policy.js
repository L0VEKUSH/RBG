'use strict';

const { isDeepStrictEqual } = require('node:util');
const ErrorResponse = require('./errorResponse');

// These fields describe index metadata or server-generated versions rather
// than the declared index behavior. Index names are intentionally not pinned.
const INDEX_METADATA_FIELDS = new Set([
  'key',
  'name',
  'ns',
  'v',
  'background',
  '2dsphereIndexVersion',
  'textIndexVersion',
  'buildUUID',
]);

function indexOptions(options = {}) {
  return Object.fromEntries(Object.entries(options)
    .filter(([key]) => !INDEX_METADATA_FIELDS.has(key))
    .sort(([left], [right]) => left.localeCompare(right)));
}

function indexMatches(actual, keys, options = {}) {
  if (!actual || !actual.key || !keys) return false;
  const actualKeys = Object.entries(actual.key);
  const expectedKeys = Object.entries(keys);
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every(([key, value], index) =>
      key === expectedKeys[index][0] && value === expectedKeys[index][1]) &&
    isDeepStrictEqual(indexOptions(actual), indexOptions(options));
}

function safeModelName(model) {
  return typeof model?.modelName === 'string' && /^[A-Za-z0-9_]+$/.test(model.modelName)
    ? model.modelName
    : 'required model';
}

function declaredIndexes(model) {
  if (typeof model?.schema?.indexes !== 'function') {
    throw new ErrorResponse(`Index declarations are unavailable for ${safeModelName(model)}; operation is disabled`, 503);
  }
  return model.schema.indexes();
}

async function assertIndexesPresent(model, definitions) {
  const modelName = safeModelName(model);
  if (!Array.isArray(definitions) || definitions.length === 0) return;

  let indexes;
  try {
    if (typeof model?.listIndexes !== 'function') throw new Error('Index listing is unavailable');
    indexes = await model.listIndexes();
  } catch (_) {
    throw new ErrorResponse(`Required index metadata is unavailable for ${modelName}; operation is disabled`, 503);
  }

  if (!Array.isArray(indexes)) {
    throw new ErrorResponse(`Required index metadata is invalid for ${modelName}; operation is disabled`, 503);
  }

  for (const definition of definitions) {
    if (!Array.isArray(definition) || !definition[0] ||
        !indexes.some(index => indexMatches(index, definition[0], definition[1] || {}))) {
      throw new ErrorResponse(`A required index is missing or incompatible for ${modelName}; operation is disabled`, 503);
    }
  }
}

async function assertDeclaredIndexesPresent(models) {
  if (!Array.isArray(models) || models.length === 0) {
    throw new ErrorResponse('Compiled model index declarations are unavailable; production startup is disabled', 503);
  }
  for (const model of models) {
    await assertIndexesPresent(model, declaredIndexes(model));
  }
}

async function prepareModelIndexes(model) {
  if (process.env.NODE_ENV === 'production') {
    return assertIndexesPresent(model, declaredIndexes(model));
  }
  if (typeof model?.createIndexes !== 'function') {
    throw new TypeError('Model index creation is unavailable outside production');
  }
  return model.createIndexes();
}

async function ensureIndexReady(model, keys, options = {}) {
  if (process.env.NODE_ENV === 'production') {
    return assertIndexesPresent(model, [[keys, options]]);
  }
  if (typeof model?.collection?.createIndex !== 'function') {
    throw new TypeError('Collection index creation is unavailable outside production');
  }
  return model.collection.createIndex(keys, options);
}

module.exports = {
  assertIndexesPresent,
  assertDeclaredIndexesPresent,
  ensureIndexReady,
  indexMatches,
  prepareModelIndexes,
};
