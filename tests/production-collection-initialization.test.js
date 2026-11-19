'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const { loadApplicationModels } = require('../scripts/initialize-production-collections');
const {
  EXPECTED_COLLECTION_INVENTORY,
  assertReviewedCollectionInventory,
  authorizeCollectionInitialization,
  createDatabaseAdapter,
  formatTargetIdentity,
  initializeProductionCollections,
  resolveCollectionInventory,
  verifyConnectedIdentityAndTopology,
} = require('../utils/production-collection-initialization');
const { parseArguments } = require('../utils/production-index-provisioning');

const MODEL_DIRECTORY = path.join(__dirname, '..', 'models');
const models = loadApplicationModels(MODEL_DIRECTORY);
const inventory = assertReviewedCollectionInventory(models);
const target = {
  scheme: 'mongodb+srv',
  host: 'atlas.example.invalid',
  port: 'srv',
  databaseName: 'school_management_prod',
};

function makeArgs({ execute = false, confirmation } = {}) {
  return {
    execute,
    expectedHost: target.host,
    expectedPort: target.port,
    expectedDatabase: target.databaseName,
    confirmation,
  };
}

function makeDatabase(initialNames = [], hooks = {}) {
  const metadata = new Map(initialNames.map(name => [name, { name, type: 'collection' }]));
  const calls = {
    listCollections: 0,
    createCollection: [],
    forbidden: [],
  };
  const database = {
    async listCollections() {
      calls.listCollections += 1;
      if (hooks.listCollections) return hooks.listCollections(metadata, calls);
      return [...metadata.values()].map(item => ({ ...item }));
    },
    async createCollection(name) {
      calls.createCollection.push(name);
      if (hooks.createCollection) return hooks.createCollection(name, metadata, calls);
      if (metadata.has(name)) throw new Error('NAMESPACE_EXISTS');
      metadata.set(name, { name, type: 'collection' });
      return { collectionName: name };
    },
    async createIndex() { calls.forbidden.push('createIndex'); throw new Error('FORBIDDEN_API'); },
    async createIndexes() { calls.forbidden.push('createIndexes'); throw new Error('FORBIDDEN_API'); },
    async syncIndexes() { calls.forbidden.push('syncIndexes'); throw new Error('FORBIDDEN_API'); },
    async insertOne() { calls.forbidden.push('insertOne'); throw new Error('FORBIDDEN_API'); },
    async insertMany() { calls.forbidden.push('insertMany'); throw new Error('FORBIDDEN_API'); },
    async dropCollection() { calls.forbidden.push('dropCollection'); throw new Error('FORBIDDEN_API'); },
    async renameCollection() { calls.forbidden.push('renameCollection'); throw new Error('FORBIDDEN_API'); },
  };
  return { database, metadata, calls };
}

function run({ database, args = makeArgs(), nodeEnv = 'production', connectedDatabaseName = target.databaseName,
  topology = { type: 'replicaSet' }, selectedInventory = inventory }) {
  const authorization = authorizeCollectionInitialization({
    args,
    nodeEnv,
    target,
    connectedDatabaseName,
    topology,
  });
  return initializeProductionCollections(selectedInventory, database, {
    execute: args.execute,
    authorization,
  });
}

test('the reviewed inventory includes all expected model collections, including legacy or unused models', () => {
  assert.equal(models.length, EXPECTED_COLLECTION_INVENTORY.length);
  assert.equal(inventory.length, EXPECTED_COLLECTION_INVENTORY.length);
  assert.deepEqual(inventory, EXPECTED_COLLECTION_INVENTORY);
  for (const modelName of ['Achievement', 'Complaint', 'TransportAssignment']) {
    assert.ok(inventory.some(item => item.modelName === modelName));
  }
});

test('collection resolution uses Mongoose-resolved names and honors explicit overrides', () => {
  const explicit = mongoose.model(
    'CollectionOverrideProbe',
    new mongoose.Schema({}, { collection: 'operator_selected_collection' })
  );
  assert.deepEqual(resolveCollectionInventory([explicit]), [
    { modelName: 'CollectionOverrideProbe', collectionName: 'operator_selected_collection' },
  ]);
  assert.deepEqual(resolveCollectionInventory(models), EXPECTED_COLLECTION_INVENTORY);
});

test('dry-run identifies missing collections and never creates them', async () => {
  const { database, calls } = makeDatabase(['users']);
  const result = await run({ database });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.plan.existing.some(item => item.collectionName === 'users'), true);
  assert.equal(result.plan.missing.length, EXPECTED_COLLECTION_INVENTORY.length - 1);
  assert.deepEqual(result.created, []);
  assert.deepEqual(calls.createCollection, []);
});

test('an explicitly authorized execution creates only missing collections', async () => {
  const first = inventory[0].collectionName;
  const second = inventory[1].collectionName;
  const { database, calls } = makeDatabase([first]);
  const confirmation = formatTargetIdentity(target);
  const result = await run({
    database,
    args: makeArgs({ execute: true, confirmation }),
    selectedInventory: inventory.slice(0, 2),
  });
  assert.equal(result.mode, 'complete');
  assert.deepEqual(calls.createCollection, [second]);
  assert.deepEqual(result.created, [second]);
});

test('existing collection metadata is preserved', async () => {
  const existingName = inventory[0].collectionName;
  const { database, metadata, calls } = makeDatabase([existingName]);
  const before = structuredClone(metadata.get(existingName));
  await run({
    database,
    args: makeArgs({ execute: true, confirmation: formatTargetIdentity(target) }),
    selectedInventory: inventory.slice(0, 1),
  });
  assert.deepEqual(metadata.get(existingName), before);
  assert.deepEqual(calls.createCollection, []);
});

test('non-production mode is rejected before collection inspection', async () => {
  const { database, calls } = makeDatabase();
  await assert.rejects(async () => run({ database, nodeEnv: 'development' }), {
    safeCode: 'PRODUCTION_ENVIRONMENT_REQUIRED',
  });
  assert.equal(calls.listCollections, 0);
  assert.deepEqual(calls.createCollection, []);
});

test('target identity mismatch is rejected before collection inspection', async () => {
  const { database, calls } = makeDatabase();
  await assert.rejects(async () => run({
    database,
    args: { ...makeArgs(), expectedDatabase: 'wrong_database' },
  }), { safeCode: 'TARGET_IDENTITY_MISMATCH' });
  assert.equal(calls.listCollections, 0);
});

test('standalone topology is rejected before collection inspection', async () => {
  const { database, calls } = makeDatabase();
  await assert.rejects(async () => run({ database, topology: { type: 'standalone' } }), {
    safeCode: 'TRANSACTION_CAPABLE_TOPOLOGY_REQUIRED',
  });
  assert.equal(calls.listCollections, 0);
});

test('execution requires the exact sanitized target confirmation', async () => {
  const { database, calls } = makeDatabase();
  await assert.rejects(async () => run({
    database,
    args: makeArgs({ execute: true, confirmation: 'wrong confirmation' }),
  }), { safeCode: 'PRODUCTION_TARGET_CONFIRMATION_MISMATCH' });
  assert.equal(calls.listCollections, 0);
  assert.deepEqual(calls.createCollection, []);
});

test('the execution engine refuses callers without the verified authorization gate', async () => {
  const { database, calls } = makeDatabase();
  await assert.rejects(async () => initializeProductionCollections(inventory.slice(0, 1), database, {
    execute: true,
  }), { safeCode: 'PRODUCTION_EXECUTION_NOT_AUTHORIZED' });
  assert.equal(calls.listCollections, 0);
  assert.deepEqual(calls.createCollection, []);
});

test('the CLI argument parser requires all target fields and execution confirmation', () => {
  assert.throws(() => parseArguments([
    '--expected-host=atlas.example.invalid',
    '--expected-port=srv',
    '--expected-db=school_management_prod',
    '--execute',
  ]), { safeCode: 'TARGET_CONFIRMATION_REQUIRED' });
  const parsed = parseArguments([
    '--expected-host=atlas.example.invalid',
    '--expected-port=srv',
    '--expected-db=school_management_prod',
  ]);
  assert.equal(parsed.execute, false);
});

test('existing non-collection metadata blocks execution without alteration', async () => {
  const name = inventory[0].collectionName;
  const { database, metadata, calls } = makeDatabase();
  metadata.set(name, { name, type: 'view', viewOn: 'other' });
  const before = structuredClone(metadata.get(name));
  const result = await run({
    database,
    args: makeArgs({ execute: true, confirmation: formatTargetIdentity(target) }),
    selectedInventory: inventory.slice(0, 1),
  });
  assert.equal(result.mode, 'blocked');
  assert.equal(result.plan.incompatible[0].type, 'view');
  assert.deepEqual(metadata.get(name), before);
  assert.deepEqual(calls.createCollection, []);
});

test('collection initialization never calls index, seed, insert, drop, or rename APIs', async () => {
  const { database, calls } = makeDatabase();
  const result = await run({
    database,
    args: makeArgs({ execute: true, confirmation: formatTargetIdentity(target) }),
    selectedInventory: inventory.slice(0, 1),
  });
  assert.equal(result.mode, 'complete');
  assert.deepEqual(calls.forbidden, []);
  assert.deepEqual(calls.createCollection, [inventory[0].collectionName]);
});

test('the MongoDB adapter exposes collection listing and creation only', async () => {
  const raw = {
    listCollections(_filter, options) {
      assert.equal(options.nameOnly, false);
      return { toArray: async () => [{ name: 'users', type: 'collection' }] };
    },
    async createCollection(name) { return { collectionName: name }; },
    collection() { throw new Error('INDEX_API_MUST_NOT_BE_USED'); },
  };
  const adapter = createDatabaseAdapter(raw);
  assert.deepEqual(await adapter.listCollections(), [{ name: 'users', type: 'collection' }]);
  assert.equal(typeof adapter.createCollection, 'function');
  assert.equal('createIndex' in adapter, false);
  assert.equal('insertOne' in adapter, false);
  assert.equal('dropCollection' in adapter, false);
});

test('partial creation failure is reported without retry or rollback', async () => {
  const first = inventory[0].collectionName;
  const second = inventory[1].collectionName;
  const { database, metadata, calls } = makeDatabase([], {
    createCollection(name, metadata) {
      if (name === second) throw new Error('CREATE_FAILED');
      metadata.set(name, { name, type: 'collection' });
      return { collectionName: name };
    },
  });
  const result = await run({
    database,
    args: makeArgs({ execute: true, confirmation: formatTargetIdentity(target) }),
    selectedInventory: inventory.slice(0, 2),
  });
  assert.equal(result.mode, 'partial');
  assert.equal(result.unresolved, 'COLLECTION_CREATE_OUTCOME_UNKNOWN');
  assert.deepEqual(result.created, [first]);
  assert.deepEqual(calls.createCollection, [first, second]);
  assert.equal(calls.createCollection.filter(name => name === second).length, 1);
  assert.equal(metadata.has(first), true);
  assert.equal(metadata.has(second), false);
});

test('final metadata verification detects a create that did not appear', async () => {
  const name = inventory[0].collectionName;
  let listReads = 0;
  const { database, calls } = makeDatabase([], {
    listCollections(metadata) {
      listReads += 1;
      return [...metadata.values()].map(item => ({ ...item }));
    },
    createCollection() { return { acknowledged: true }; },
  });
  const result = await run({
    database,
    args: makeArgs({ execute: true, confirmation: formatTargetIdentity(target) }),
    selectedInventory: inventory.slice(0, 1),
  });
  assert.equal(result.mode, 'partial');
  assert.equal(result.unresolved, 'POST_CREATE_VERIFICATION_FAILED');
  assert.deepEqual(result.plan.missing.map(item => item.collectionName), [name]);
  assert.equal(calls.createCollection.length, 1);
  assert.ok(listReads >= 3);
});

test('connected identity and hello topology are checked without exposing URI data', async () => {
  const args = makeArgs();
  const { databaseName, topology } = await verifyConnectedIdentityAndTopology({
    db: {
      databaseName: target.databaseName,
      admin: () => ({
        command: async () => ({
          setName: 'school-rs',
          isWritablePrimary: true,
          me: 'node-a.example.invalid:27017',
          primary: 'node-a.example.invalid:27017',
          hosts: ['node-a.example.invalid:27017', 'node-b.example.invalid:27017'],
        }),
      }),
    },
  }, { args, nodeEnv: 'production', target });
  assert.equal(databaseName, target.databaseName);
  assert.equal(topology.type, 'replicaSet');
});

