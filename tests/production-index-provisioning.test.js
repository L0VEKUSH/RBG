'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  authorizeTarget,
  buildUniqueDuplicatePipeline,
  inspectIndexes,
  parseArguments,
  parseMongoTarget,
  provisionIndexes,
  verifyConnectedIdentity,
} = require('../utils/production-index-provisioning');
const {
  configureMongooseForEnvironment,
  getMongooseConnectionOptions,
} = require('../utils/mongoose-connection-options');

const REPO_ROOT = path.join(__dirname, '..');
const TARGET_URI = 'mongodb+srv://operator:secret@cluster.example.net/school_db?retryWrites=true';
const TARGET = parseMongoTarget(TARGET_URI);
const EXPECTED_TARGET = {
  expectedHost: 'cluster.example.net',
  expectedPort: 'srv',
  expectedDatabase: 'school_db',
};
const CONFIRMATION = 'mongodb+srv://cluster.example.net/school_db';
const ID_INDEX = { name: '_id_', key: { _id: 1 }, unique: true, v: 2 };

function modelWithIndex(keys, options = {}) {
  return {
    modelName: 'SyntheticRecord',
    collection: { collectionName: 'syntheticrecords' },
    schema: { indexes: () => [[keys, options]] },
  };
}

function fakeDatabase({ indexes = [ID_INDEX], duplicate = false } = {}) {
  const calls = [];
  let currentIndexes = [...indexes];
  const database = {
    calls,
    async listCollectionNames() { calls.push('collections'); return ['syntheticrecords']; },
    async collectionExists(name) { calls.push(`exists:${name}`); return name === 'syntheticrecords'; },
    async listIndexes(name) { calls.push(`indexes:${name}`); return currentIndexes; },
    async hasDuplicateKeyGroup(name, keys, options) {
      calls.push(`duplicates:${name}`);
      assert.equal(options.unique, true);
      return duplicate;
    },
    async createIndex(name, keys, options) {
      calls.push(`create:${name}`);
      currentIndexes = [...currentIndexes, { name: Object.keys(keys).join('_'), key: keys, ...options }];
      return 'created';
    },
  };
  return database;
}

test('production Mongoose settings disable automatic indexes and collections', () => {
  const settings = [];
  const mongoose = { set: (name, value) => settings.push([name, value]) };
  assert.deepEqual(getMongooseConnectionOptions('production'), { autoIndex: false, autoCreate: false });
  assert.deepEqual(configureMongooseForEnvironment(mongoose, 'production'), {
    autoIndex: false,
    autoCreate: false,
  });
  assert.deepEqual(settings, [['autoIndex', false], ['autoCreate', false]]);
});

test('non-production retains automatic index and collection behavior', () => {
  assert.deepEqual(getMongooseConnectionOptions('test'), { autoIndex: true, autoCreate: true });
});

test('each production connection path applies shared options to Mongoose and connect', () => {
  const paths = ['server.js', 'config/db.js', 'scripts/email-worker.js'];
  for (const relativePath of paths) {
    const source = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.match(source, /configureMongooseForEnvironment\((?:runtime\.)?mongoose,\s*(?:runtime\.)?NODE_ENV\)/, relativePath);
    assert.match(source, /(?:runtime\.)?mongoose\.connect\((?:runtime\.)?MONGO_URI,\s*(?:runtime\.)?mongoose(?:Connection)?Options\)/, relativePath);
  }
});

test('argument parsing defaults to dry-run and accepts no target URI or arbitrary flags', () => {
  const args = parseArguments([
    '--expected-host=cluster.example.net',
    '--expected-port=srv',
    '--expected-db=school_db',
  ]);
  assert.equal(args.execute, false);
  assert.throws(() => parseArguments(['--uri=mongodb://untrusted']), /INVALID_ARGUMENTS/);
  assert.throws(() => parseArguments([
    '--execute',
    '--expected-host=cluster.example.net',
    '--expected-port=srv',
    '--expected-db=school_db',
  ]), /TARGET_CONFIRMATION_REQUIRED/);
});

test('execution requires an explicit matching production-target confirmation', () => {
  const args = parseArguments([
    '--execute',
    '--expected-host=cluster.example.net',
    '--expected-port=srv',
    '--expected-db=school_db',
    `--confirm-production-target=${CONFIRMATION}`,
  ]);
  assert.equal(authorizeTarget({ args, nodeEnv: 'production', target: TARGET }), true);
  assert.throws(() => authorizeTarget({ args, nodeEnv: 'test', target: TARGET }), /PRODUCTION_ENVIRONMENT_REQUIRED/);
  const wrongArgs = { ...args, confirmation: 'mongodb+srv://other.example.net/school_db' };
  assert.throws(() => authorizeTarget({ args: wrongArgs, nodeEnv: 'production', target: TARGET }),
    /PRODUCTION_TARGET_CONFIRMATION_MISMATCH/);
});

test('sanitized target and connected database identity are checked before operations', async () => {
  const target = parseMongoTarget(TARGET_URI);
  assert.deepEqual(target, {
    scheme: 'mongodb+srv',
    host: 'cluster.example.net',
    port: 'srv',
    databaseName: 'school_db',
  });
  assert.equal(JSON.stringify(target).includes('secret'), false);
  const args = { ...EXPECTED_TARGET, execute: false };
  const hello = {
    setName: 'production-rs',
    isWritablePrimary: true,
    secondary: false,
    me: 'db-0.example.net:27017',
    primary: 'db-0.example.net:27017',
    hosts: ['db-0.example.net:27017', 'db-1.example.net:27017'],
  };
  const connection = {
    db: {
      databaseName: 'school_db',
      admin: () => ({ command: async () => hello }),
    },
  };
  assert.deepEqual(await verifyConnectedIdentity(connection, target, args, 'production'), {
    type: 'replicaSet',
    replicaSet: 'production-rs',
    primary: 'db-0.example.net:27017',
  });
  await assert.rejects(
    verifyConnectedIdentity({ db: { databaseName: 'wrong_db', admin: connection.db.admin } }, target, args, 'production'),
    /CONNECTED_DATABASE_MISMATCH/
  );
  await assert.rejects(
    verifyConnectedIdentity({ db: { admin: connection.db.admin } }, target, args, 'production'),
    /CONNECTED_DATABASE_UNVERIFIED/
  );
  await assert.rejects(
    verifyConnectedIdentity(connection, target, { ...args, expectedHost: 'other.example.net' }, 'production'),
    /TARGET_IDENTITY_MISMATCH/
  );
  await assert.rejects(
    verifyConnectedIdentity({ db: { databaseName: 'school_db', admin: () => ({ command: async () => ({ isWritablePrimary: true }) }) } }, target, args, 'production'),
    /TOPOLOGY_UNEXPECTED/
  );
});

test('unique duplicate pipeline applies sparse and partial membership without exposing group keys', () => {
  const pipeline = buildUniqueDuplicatePipeline(
    { student: 1, academicYear: 1 },
    { unique: true, sparse: true, partialFilterExpression: { active: true } },
  );
  assert.deepEqual(pipeline[0], { $match: { active: true } });
  assert.deepEqual(pipeline[1], {
    $match: { $or: [{ student: { $exists: true } }, { academicYear: { $exists: true } }] },
  });
  assert.deepEqual(pipeline.at(-1), { $limit: 1 });
  assert.equal(JSON.stringify(pipeline).includes('studentValue'), false);
});

test('duplicate data blocks a missing unique index before createIndex is called', async () => {
  const model = modelWithIndex({ email: 1 }, { unique: true });
  const database = fakeDatabase({ duplicate: true });
  const result = await provisionIndexes([model], database, { execute: true });
  assert.equal(result.mode, 'blocked');
  assert.deepEqual(result.plan.collections[0].duplicateKeys, [{ keys: { email: 1 }, duplicatesFound: true }]);
  assert.equal(database.calls.some(call => call.startsWith('create:')), false);
});

test('unique duplicate check runs immediately before creating a missing index', async () => {
  const model = modelWithIndex({ email: 1 }, { unique: true });
  const database = fakeDatabase({ duplicate: false });
  const result = await provisionIndexes([model], database, { execute: true });
  assert.equal(result.mode, 'complete');
  assert.ok(database.calls.lastIndexOf('duplicates:syntheticrecords') < database.calls.indexOf('create:syntheticrecords'));
});

test('incompatible existing index blocks execution without replacing or creating indexes', async () => {
  const model = modelWithIndex({ email: 1 }, { unique: true });
  const database = fakeDatabase({ indexes: [ID_INDEX, { name: 'email_1', key: { email: 1 }, unique: false }] });
  const result = await provisionIndexes([model], database, { execute: true });
  assert.equal(result.mode, 'blocked');
  assert.equal(result.plan.collections[0].incompatible.length, 1);
  assert.equal(database.calls.some(call => call.startsWith('create:')), false);
});

test('dry-run reports missing indexes without creating them and missing collections block execution', async () => {
  const model = modelWithIndex({ email: 1 }, { unique: true });
  const database = fakeDatabase({ duplicate: false });
  const dryRun = await provisionIndexes([model], database);
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.plan.collections[0].missing.length, 1);
  assert.equal(database.calls.some(call => call.startsWith('create:')), false);

  const absentCollectionDatabase = {
    ...database,
    async listCollectionNames() { return []; },
  };
  const absent = await inspectIndexes([model], absentCollectionDatabase);
  assert.equal(absent.canExecute, false);
  assert.equal(absent.collections[0].collectionExists, false);
  const absentExecution = await provisionIndexes([model], absentCollectionDatabase, { execute: true });
  assert.equal(absentExecution.mode, 'blocked');
  assert.equal(database.calls.some(call => call.startsWith('create:')), false);
});

test('unrecognized existing indexes block execution without an automatic replacement', async () => {
  const model = modelWithIndex({ email: 1 }, { unique: true });
  const database = fakeDatabase({ indexes: [ID_INDEX, { name: 'operator_index', key: { status: 1 } }] });
  const result = await provisionIndexes([model], database, { execute: true });
  assert.equal(result.mode, 'blocked');
  assert.equal(result.plan.collections[0].extra.length, 1);
  assert.equal(database.calls.some(call => call.startsWith('create:')), false);
});

test('runtime pin and deployment guidance use the same selected patch', () => {
  const version = fs.readFileSync(path.join(REPO_ROOT, '.node-version'), 'utf8').trim();
  const deploymentDoc = fs.readFileSync(path.join(REPO_ROOT, 'docs/render-deployment-preparation.md'), 'utf8');
  assert.equal(version, '24.22.2');
  assert.equal(deploymentDoc.includes('24.22.1'), false);
  assert.ok(deploymentDoc.includes('24.22.2'));
});

test('provisioning source has no destructive or synchronizing index calls and loads no app config', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'scripts/provision-production-indexes.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:syncIndexes|dropIndex|dropCollection|dropDatabase)\s*\(/);
  assert.doesNotMatch(source, /config[\\/]env|dotenv/);
  assert.match(source, /require\.main === module/);
});
