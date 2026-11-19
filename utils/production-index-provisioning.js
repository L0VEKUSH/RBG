'use strict';

const { indexMatches } = require('./mongoose-index-policy');

const HOST_PATTERN = /^[a-z0-9.-]{1,253}$/i;
const DATABASE_PATTERN = /^[A-Za-z0-9_-]{1,63}$/;
const PORT_PATTERN = /^(?:srv|[0-9]{1,5})$/;

function fail(code) {
  const error = new Error(code);
  error.safeCode = code;
  throw error;
}

function parseArguments(argv) {
  const values = Object.create(null);
  let execute = false;

  for (const argument of argv) {
    if (argument === '--execute') {
      if (execute) fail('DUPLICATE_ARGUMENT');
      execute = true;
      continue;
    }

    const match = /^(--expected-host|--expected-port|--expected-db|--confirm-production-target)=(.*)$/.exec(argument);
    if (!match || !match[2] || Object.prototype.hasOwnProperty.call(values, match[1])) {
      fail('INVALID_ARGUMENTS');
    }
    values[match[1]] = match[2];
  }

  const expectedHost = values['--expected-host'];
  const expectedPort = values['--expected-port'];
  const expectedDatabase = values['--expected-db'];
  const confirmation = values['--confirm-production-target'];
  if (!expectedHost || !HOST_PATTERN.test(expectedHost) ||
      !expectedPort || !PORT_PATTERN.test(expectedPort) ||
      !expectedDatabase || !DATABASE_PATTERN.test(expectedDatabase) ||
      (expectedPort !== 'srv' && (Number(expectedPort) < 1 || Number(expectedPort) > 65535)) ||
      (execute && !confirmation) || (!execute && confirmation)) {
    fail('TARGET_CONFIRMATION_REQUIRED');
  }

  return {
    execute,
    expectedHost: expectedHost.toLowerCase(),
    expectedPort,
    expectedDatabase,
    confirmation,
  };
}

function parseMongoTarget(uri) {
  if (typeof uri !== 'string' || !uri) fail('MONGO_URI_REQUIRED');

  let parsed;
  try {
    parsed = new URL(uri);
  } catch (_) {
    fail('MONGO_URI_INVALID');
  }

  const scheme = parsed.protocol.slice(0, -1);
  if (!['mongodb', 'mongodb+srv'].includes(scheme) || parsed.hash) fail('MONGO_URI_INVALID');
  const host = parsed.hostname.toLowerCase();
  if (!host || host.includes(',') || host.includes(':') || !HOST_PATTERN.test(host)) {
    fail('MONGO_TARGET_HOST_UNSUPPORTED');
  }
  if (scheme === 'mongodb+srv' && parsed.port) fail('MONGO_TARGET_PORT_UNSUPPORTED');

  let databaseName;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch (_) {
    fail('MONGO_URI_INVALID');
  }
  if (!DATABASE_PATTERN.test(databaseName)) fail('MONGO_TARGET_DATABASE_UNSUPPORTED');

  return {
    scheme,
    host,
    port: scheme === 'mongodb+srv' ? 'srv' : (parsed.port || '27017'),
    databaseName,
  };
}

function formatTargetIdentity(target) {
  const portPart = target.scheme === 'mongodb+srv' ? '' : `:${target.port}`;
  return `${target.scheme}://${target.host}${portPart}/${target.databaseName}`;
}

function authorizeTarget({ args, nodeEnv, target, connectedDatabaseName }) {
  if (nodeEnv !== 'production') fail('PRODUCTION_ENVIRONMENT_REQUIRED');
  if (!args || !target ||
      args.expectedHost !== target.host ||
      args.expectedPort !== target.port ||
      args.expectedDatabase !== target.databaseName) {
    fail('TARGET_IDENTITY_MISMATCH');
  }
  if (connectedDatabaseName !== undefined && connectedDatabaseName !== target.databaseName) {
    fail('CONNECTED_DATABASE_MISMATCH');
  }
  if (args.execute && args.confirmation !== formatTargetIdentity(target)) {
    fail('PRODUCTION_TARGET_CONFIRMATION_MISMATCH');
  }
  return true;
}

function verifyHelloTopology(hello) {
  if (!hello || typeof hello !== 'object' || Array.isArray(hello)) fail('TOPOLOGY_UNVERIFIED');

  if (hello.msg === 'isdbgrid') {
    if (hello.isWritablePrimary !== true || hello.setName !== undefined ||
        hello.me !== undefined || hello.primary !== undefined || hello.hosts !== undefined) {
      fail('TOPOLOGY_UNEXPECTED');
    }
    return { type: 'sharded' };
  }

  if (typeof hello.setName !== 'string' || !hello.setName ||
      hello.isWritablePrimary !== true ||
      (hello.secondary !== undefined && hello.secondary !== false) ||
      (hello.arbiterOnly !== undefined && hello.arbiterOnly !== false) ||
      typeof hello.me !== 'string' || typeof hello.primary !== 'string' ||
      hello.me !== hello.primary || !Array.isArray(hello.hosts) ||
      hello.hosts.length === 0 || hello.hosts.some(member => typeof member !== 'string' || !member) ||
      !hello.hosts.includes(hello.me) || !hello.hosts.includes(hello.primary)) {
    fail('TOPOLOGY_UNEXPECTED');
  }

  return { type: 'replicaSet', replicaSet: hello.setName, primary: hello.primary };
}

async function verifyConnectedIdentity(connection, target, args, nodeEnv) {
  const databaseName = connection?.db?.databaseName;
  if (typeof databaseName !== 'string' || !databaseName) fail('CONNECTED_DATABASE_UNVERIFIED');
  authorizeTarget({ args, nodeEnv, target, connectedDatabaseName: databaseName });
  if (!connection?.db?.admin || typeof connection.db.admin !== 'function') fail('TOPOLOGY_UNVERIFIED');

  let hello;
  try {
    hello = await connection.db.admin().command({ hello: 1 });
  } catch (_) {
    fail('TOPOLOGY_UNVERIFIED');
  }
  return verifyHelloTopology(hello);
}

function sameKeyFields(left, right) {
  if (!left || !right) return false;
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return leftEntries.length === rightEntries.length &&
    leftEntries.every(([field], index) => field === rightEntries[index][0]);
}

function classifyIndexes(declared, actual) {
  const used = new Set();
  const present = [];
  const incompatible = [];
  const missing = [];

  const idIndex = actual.find(index => index?.name === '_id_' &&
    index.key && Object.keys(index.key).length === 1 && index.key._id === 1 && index.unique === true);
  if (idIndex) used.add(idIndex);
  else incompatible.push({ kind: 'implicit-id-index' });

  for (const definition of declared) {
    if (!Array.isArray(definition) || !definition[0] || typeof definition[0] !== 'object') {
      incompatible.push({ kind: 'invalid-declaration' });
      continue;
    }
    const [keys, options = {}] = definition;
    const match = actual.find(index => !used.has(index) && indexMatches(index, keys, options));
    if (match) {
      used.add(match);
      present.push({ keys, options });
      continue;
    }

    const conflicting = actual.filter(index => index?.key && sameKeyFields(index.key, keys));
    if (conflicting.length > 0) {
      incompatible.push({ keys, actual: conflicting.map(index => ({ name: index.name, key: index.key })) });
      conflicting.forEach(index => used.add(index));
    } else {
      missing.push({ keys, options });
    }
  }

  const extra = actual
    .filter(index => !used.has(index))
    .map(index => ({ name: index.name, key: index.key }));
  return { present, missing, incompatible, extra };
}

function buildUniqueDuplicatePipeline(keys, options = {}) {
  const fields = Object.keys(keys || {});
  if (fields.length === 0 || fields.some(field => !field || field.includes('\0'))) {
    fail('UNIQUE_INDEX_DECLARATION_UNSUPPORTED');
  }

  const pipeline = [];
  if (options.partialFilterExpression) {
    pipeline.push({ $match: options.partialFilterExpression });
  }
  if (options.sparse) {
    pipeline.push({
      $match: {
        $or: fields.map(field => ({ [field]: { $exists: true } })),
      },
    });
  }

  const groupKey = {};
  fields.forEach((field, index) => {
    groupKey[`k${index}`] = { $ifNull: [`$${field}`, null] };
  });
  pipeline.push(
    { $group: { _id: groupKey, duplicateCount: { $sum: 1 } } },
    { $match: { duplicateCount: { $gt: 1 } } },
    { $limit: 1 },
  );
  return pipeline;
}

async function inspectIndexes(models, database) {
  const names = await database.listCollectionNames();
  if (!Array.isArray(names)) fail('COLLECTION_METADATA_INVALID');
  const collectionNames = new Set(names);
  const collections = [];

  for (const model of models) {
    if (typeof model?.schema?.indexes !== 'function' ||
        typeof model?.collection?.collectionName !== 'string') {
      fail('MODEL_INDEX_DECLARATION_INVALID');
    }
    const collectionName = model.collection.collectionName;
    const declared = model.schema.indexes();
    if (!Array.isArray(declared) || declared.some(definition =>
      !Array.isArray(definition) || !definition[0] || typeof definition[0] !== 'object')) {
      fail('MODEL_INDEX_DECLARATION_INVALID');
    }
    if (!collectionNames.has(collectionName)) {
      collections.push({
        modelName: model.modelName,
        collectionName,
        collectionExists: false,
        present: [],
        missing: declared.map(([keys, options = {}]) => ({ keys, options })),
        incompatible: [],
        extra: [],
        duplicateKeys: [],
      });
      continue;
    }

    const actual = await database.listIndexes(collectionName);
    if (!Array.isArray(actual)) fail('INDEX_METADATA_INVALID');
    const classified = classifyIndexes(declared, actual);
    const duplicateKeys = [];
    for (const index of classified.missing) {
      if (index.options.unique === true) {
        const duplicatesFound = await database.hasDuplicateKeyGroup(collectionName, index.keys, index.options);
        if (duplicatesFound) duplicateKeys.push({ keys: index.keys, duplicatesFound: true });
      }
    }
    collections.push({
      modelName: model.modelName,
      collectionName,
      collectionExists: true,
      ...classified,
      duplicateKeys,
    });
  }

  return {
    collections,
    canExecute: collections.every(collection => collection.collectionExists &&
      collection.incompatible.length === 0 && collection.extra.length === 0 &&
      collection.duplicateKeys.length === 0),
  };
}

async function provisionIndexes(models, database, { execute = false } = {}) {
  const initialPlan = await inspectIndexes(models, database);
  if (!execute) return { mode: 'dry-run', plan: initialPlan, created: [] };
  if (!initialPlan.canExecute) return { mode: 'blocked', plan: initialPlan, created: [] };

  const created = [];
  for (const collection of initialPlan.collections) {
    for (const index of collection.missing) {
      if (!await database.collectionExists(collection.collectionName)) {
        return { mode: 'partial', plan: initialPlan, created, unresolved: 'COLLECTION_DISAPPEARED' };
      }
      if (index.options.unique === true &&
          await database.hasDuplicateKeyGroup(collection.collectionName, index.keys, index.options)) {
        return { mode: 'partial', plan: initialPlan, created, unresolved: 'DUPLICATE_KEYS_FOUND' };
      }

      try {
        await database.createIndex(collection.collectionName, index.keys, index.options);
      } catch (_) {
        // A failed create may have an uncertain outcome. Read once; never retry
        // the create command or attempt to replace an incompatible index.
        let currentIndexes;
        try {
          currentIndexes = await database.listIndexes(collection.collectionName);
        } catch (_) {
          return { mode: 'partial', plan: initialPlan, created, unresolved: 'INDEX_CREATE_OUTCOME_UNKNOWN' };
        }
        if (!currentIndexes.some(actual => indexMatches(actual, index.keys, index.options))) {
          return { mode: 'partial', plan: initialPlan, created, unresolved: 'INDEX_CREATE_FAILED' };
        }
      }
      created.push({ modelName: collection.modelName, collectionName: collection.collectionName, keys: index.keys });
    }
  }

  const finalPlan = await inspectIndexes(models, database);
  if (!finalPlan.canExecute || finalPlan.collections.some(collection => collection.missing.length > 0)) {
    return { mode: 'partial', plan: finalPlan, created, unresolved: 'FINAL_INDEX_VERIFICATION_FAILED' };
  }
  return { mode: 'complete', plan: finalPlan, created };
}

module.exports = {
  authorizeTarget,
  buildUniqueDuplicatePipeline,
  classifyIndexes,
  formatTargetIdentity,
  inspectIndexes,
  parseArguments,
  parseMongoTarget,
  provisionIndexes,
  verifyConnectedIdentity,
  verifyHelloTopology,
};
