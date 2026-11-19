'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  EXPECTED_COLLECTION_INVENTORY,
  assertReviewedCollectionInventory,
  loadProductionModels,
  resolveCollectionInventory,
} = require('../utils/production-model-inventory');
const { assertRequiredCollectionsPresent } = require('../utils/mongoose-collection-policy');
const { assertProductionDatabaseReady } = require('../utils/production-database-readiness');

function mockModels(inventory = EXPECTED_COLLECTION_INVENTORY) {
  return inventory.map(({ modelName, collectionName }) => ({
    modelName,
    collection: { collectionName },
    schema: { indexes: () => [] },
  }));
}

function mockDatabase(metadata = EXPECTED_COLLECTION_INVENTORY.map(({ collectionName }) => ({
  name: collectionName,
  type: 'collection',
}))) {
  const calls = [];
  return {
    calls,
    listCollections(filter, options) {
      calls.push(['listCollections', filter, options]);
      return { toArray: async () => metadata };
    },
    createCollection() { calls.push(['createCollection']); throw new Error('MUTATION_FORBIDDEN'); },
    createIndex() { calls.push(['createIndex']); throw new Error('MUTATION_FORBIDDEN'); },
    syncIndexes() { calls.push(['syncIndexes']); throw new Error('MUTATION_FORBIDDEN'); },
    insertOne() { calls.push(['insertOne']); throw new Error('MUTATION_FORBIDDEN'); },
  };
}

test('reviewed inventory contains all 37 expected models, including retained legacy models', () => {
  assert.equal(EXPECTED_COLLECTION_INVENTORY.length, 37);
  assert.deepEqual(
    EXPECTED_COLLECTION_INVENTORY.map(({ modelName }) => modelName),
    mockModels().map(({ modelName }) => modelName)
  );
  for (const name of ['Achievement', 'Complaint', 'TransportAssignment']) {
    assert.ok(EXPECTED_COLLECTION_INVENTORY.some(item => item.modelName === name));
  }
});

test('Mongoose-resolved collection names match the reviewed manifest', () => {
  mongoose.set('autoCreate', false);
  mongoose.set('autoIndex', false);
  assert.equal(mongoose.get('autoCreate'), false);
  assert.equal(mongoose.get('autoIndex'), false);
  assert.equal(mongoose.connection.readyState, 0);
  const models = loadProductionModels(mongoose);
  assert.equal(models.length, EXPECTED_COLLECTION_INVENTORY.length);
  assert.deepEqual(resolveCollectionInventory(models), EXPECTED_COLLECTION_INVENTORY);
  assert.deepEqual(assertReviewedCollectionInventory(models), EXPECTED_COLLECTION_INVENTORY);

  const registrySize = Object.keys(mongoose.models).length;
  const again = loadProductionModels(mongoose);
  assert.equal(Object.keys(mongoose.models).length, registrySize);
  assert.ok(models.every((model, index) => model === again[index]));
  assert.equal(mongoose.connection.readyState, 0);
});

test('already registered models are reused without compiling or requiring them again', () => {
  const models = mockModels();
  const registry = Object.fromEntries(models.map(model => [model.modelName, model]));
  let requires = 0;
  const loaded = loadProductionModels({ models: registry }, () => {
    requires += 1;
    throw new Error('REGISTERED_MODEL_MUST_NOT_BE_REQUIRED');
  });
  assert.equal(requires, 0);
  assert.deepEqual(loaded, models);
});

test('unregistered models load once through their canonical module and register under expected names', () => {
  const registry = Object.create(null);
  const calls = [];
  const loaded = loadProductionModels({ models: registry }, (modelName) => {
    calls.push(modelName);
    const expected = EXPECTED_COLLECTION_INVENTORY.find(item => item.modelName === modelName);
    const model = {
      modelName,
      collection: { collectionName: expected.collectionName },
    };
    registry[modelName] = model;
    return model;
  });
  assert.equal(loaded.length, EXPECTED_COLLECTION_INVENTORY.length);
  assert.equal(calls.length, EXPECTED_COLLECTION_INVENTORY.length);
  assert.equal(new Set(calls).size, EXPECTED_COLLECTION_INVENTORY.length);
});

test('existing required collections pass using Mongoose-resolved names', async () => {
  const database = mockDatabase();
  const result = await assertRequiredCollectionsPresent(mockModels(), database);
  assert.deepEqual(result, { verifiedCollections: EXPECTED_COLLECTION_INVENTORY.length });
  assert.deepEqual(database.calls, [['listCollections', {}, { nameOnly: false }]]);
});

test('one missing collection fails with its safe collection name', async () => {
  const missing = 'counters';
  const database = mockDatabase(EXPECTED_COLLECTION_INVENTORY
    .filter(item => item.collectionName !== missing)
    .map(item => ({ name: item.collectionName, type: 'collection' })));
  await assert.rejects(
    assertRequiredCollectionsPresent(mockModels(), database),
    error => error.safeCode === 'REQUIRED_COLLECTIONS_MISSING' &&
      error.missingCollections.length === 1 &&
      error.missingCollections[0] === missing
  );
});

test('multiple missing collections are reported together and deterministically', async () => {
  const missing = ['counters', 'workerleases'];
  const database = mockDatabase(EXPECTED_COLLECTION_INVENTORY
    .filter(item => !missing.includes(item.collectionName))
    .map(item => ({ name: item.collectionName, type: 'collection' })));
  await assert.rejects(
    assertRequiredCollectionsPresent(mockModels(), database),
    error => {
      assert.equal(error.safeCode, 'REQUIRED_COLLECTIONS_MISSING');
      assert.deepEqual(error.missingCollections, missing);
      return true;
    }
  );
});

test('metadata permission and cursor errors fail closed without forwarding server messages', async () => {
  const databases = [
    { listCollections() { throw new Error('synthetic permission failure'); } },
    { listCollections() { return { toArray: async () => { throw new Error('synthetic cursor failure'); } }; } },
  ];
  for (const database of databases) {
    await assert.rejects(
      assertRequiredCollectionsPresent(mockModels(), database),
      error => error.safeCode === 'COLLECTION_METADATA_UNAVAILABLE' &&
        !error.message.includes('synthetic')
    );
  }
});

test('views or other metadata kinds do not satisfy a required collection', async () => {
  const metadata = EXPECTED_COLLECTION_INVENTORY.map(({ collectionName }) => ({
    name: collectionName,
    type: collectionName === 'counters' ? 'view' : 'collection',
  }));
  await assert.rejects(
    assertRequiredCollectionsPresent(mockModels(), mockDatabase(metadata)),
    error => error.safeCode === 'REQUIRED_COLLECTIONS_INCOMPATIBLE' &&
      error.incompatibleCollections[0] === 'counters'
  );
});

test('collection readiness uses only metadata reads and never calls mutation APIs', async () => {
  const database = mockDatabase();
  await assertRequiredCollectionsPresent(mockModels(), database);
  assert.deepEqual(database.calls.map(call => call[0]), ['listCollections']);
});

test('database readiness checks collections before the separate index check', async () => {
  const calls = [];
  const database = mockDatabase();
  const originalList = database.listCollections;
  database.listCollections = (...args) => {
    calls.push('collections');
    return originalList(...args);
  };
  await assertProductionDatabaseReady({
    models: mockModels(),
    database,
    indexCheck: async models => {
      assert.equal(models.length, EXPECTED_COLLECTION_INVENTORY.length);
      calls.push('indexes');
    },
  });
  assert.deepEqual(calls, ['collections', 'indexes']);
});

test('web and worker source gates run before readiness, recovery, reconciliation, and job consumption', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'scripts/email-worker.js'), 'utf8');

  assert.ok(server.indexOf('await assertProductionDatabaseReady') < server.indexOf('productionStartupReady = true'));
  assert.ok(server.indexOf('await assertProductionDatabaseReady') < server.indexOf('startHttpServer();'));
  const workerStartup = worker.indexOf('await runEmailWorkerPreflight');
  assert.ok(workerStartup >= 0);
  const recoveryIndex = worker.indexOf('recoverStaleAdmissionSagas', workerStartup);
  assert.ok(recoveryIndex > workerStartup);
  assert.ok(worker.indexOf('verifyDatabaseReadiness: async', workerStartup) < recoveryIndex);
  const workerConstructorIndex = worker.search(/new\s+(?:runtime\.)?Worker/);
  assert.ok(workerConstructorIndex > workerStartup);
});
