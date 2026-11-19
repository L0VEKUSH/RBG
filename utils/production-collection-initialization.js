'use strict';

const { verifyHelloTopology } = require('./production-index-provisioning');
const {
  EXPECTED_COLLECTION_INVENTORY,
  assertReviewedCollectionInventory,
  resolveCollectionInventory,
} = require('./production-model-inventory');
const EXECUTION_AUTHORIZATION = Symbol('verified production collection initialization');

function fail(code) {
  const error = new Error(code);
  error.safeCode = code;
  throw error;
}

function formatTargetIdentity(target) {
  if (!target || typeof target.host !== 'string' || typeof target.port !== 'string' ||
      typeof target.databaseName !== 'string') {
    fail('TARGET_IDENTITY_UNVERIFIED');
  }
  // Deliberately not a URI: this sanitized identity contains no credentials,
  // query parameters, or connection-string syntax.
  return `host=${target.host};port=${target.port};database=${target.databaseName}`;
}

function authorizeCollectionTarget({ args, nodeEnv, target, connectedDatabaseName }) {
  if (nodeEnv !== 'production') fail('PRODUCTION_ENVIRONMENT_REQUIRED');
  if (!args || !target ||
      args.expectedHost !== target.host ||
      args.expectedPort !== target.port ||
      args.expectedDatabase !== target.databaseName) {
    fail('TARGET_IDENTITY_MISMATCH');
  }
  if (typeof connectedDatabaseName !== 'string' || !connectedDatabaseName) {
    fail('CONNECTED_DATABASE_UNVERIFIED');
  }
  if (connectedDatabaseName !== target.databaseName) fail('CONNECTED_DATABASE_MISMATCH');
  if (args.execute === true && args.confirmation !== formatTargetIdentity(target)) {
    fail('PRODUCTION_TARGET_CONFIRMATION_MISMATCH');
  }
  if (args.execute !== true && args.confirmation) fail('UNEXPECTED_TARGET_CONFIRMATION');
  return true;
}

function assertTransactionCapableTopology(topology) {
  if (!topology || !['replicaSet', 'sharded'].includes(topology.type)) {
    fail('TRANSACTION_CAPABLE_TOPOLOGY_REQUIRED');
  }
  return topology;
}

function authorizeCollectionInitialization({ args, nodeEnv, target, connectedDatabaseName, topology }) {
  authorizeCollectionTarget({ args, nodeEnv, target, connectedDatabaseName });
  assertTransactionCapableTopology(topology);
  return EXECUTION_AUTHORIZATION;
}

async function verifyConnectedIdentityAndTopology(connection, { args, nodeEnv, target }) {
  const databaseName = connection?.db?.databaseName;
  authorizeCollectionTarget({ args, nodeEnv, target, connectedDatabaseName: databaseName });
  if (typeof connection?.db?.admin !== 'function') fail('TOPOLOGY_UNVERIFIED');

  let hello;
  try {
    hello = await connection.db.admin().command({ hello: 1 });
  } catch (_) {
    fail('TOPOLOGY_UNVERIFIED');
  }
  const topology = verifyHelloTopology(hello);
  assertTransactionCapableTopology(topology);
  const authorization = authorizeCollectionInitialization({
    args,
    nodeEnv,
    target,
    connectedDatabaseName: databaseName,
    topology,
  });
  return { databaseName, topology, authorization };
}

async function inspectCollections(inventory, database) {
  if (!database || typeof database.listCollections !== 'function') {
    fail('COLLECTION_METADATA_UNAVAILABLE');
  }

  let metadata;
  try {
    metadata = await database.listCollections();
  } catch (_) {
    fail('COLLECTION_METADATA_UNAVAILABLE');
  }
  if (!Array.isArray(metadata)) fail('COLLECTION_METADATA_INVALID');

  const byName = new Map();
  for (const item of metadata) {
    if (!item || typeof item.name !== 'string' || !item.name || byName.has(item.name)) {
      fail('COLLECTION_METADATA_INVALID');
    }
    byName.set(item.name, item);
  }

  const existing = [];
  const missing = [];
  const incompatible = [];
  for (const item of inventory) {
    const actual = byName.get(item.collectionName);
    const row = { ...item };
    if (!actual) {
      missing.push(row);
    } else if (actual.type === 'collection') {
      existing.push({ ...row, type: actual.type });
    } else {
      incompatible.push({ ...row, type: typeof actual.type === 'string' ? actual.type : 'unknown' });
    }
  }

  return {
    existing,
    missing,
    incompatible,
    canExecute: incompatible.length === 0,
    ready: missing.length === 0 && incompatible.length === 0,
  };
}

function validateDatabaseInterface(database) {
  if (!database || typeof database.listCollections !== 'function' ||
      typeof database.createCollection !== 'function') {
    fail('COLLECTION_DATABASE_INTERFACE_INVALID');
  }
}

async function initializeProductionCollections(
  inventory,
  database,
  { execute = false, authorization } = {}
) {
  validateDatabaseInterface(database);
  if (execute && authorization !== EXECUTION_AUTHORIZATION) {
    fail('PRODUCTION_EXECUTION_NOT_AUTHORIZED');
  }
  const initialPlan = await inspectCollections(inventory, database);
  if (!execute) return { mode: 'dry-run', plan: initialPlan, created: [] };
  if (!initialPlan.canExecute) return { mode: 'blocked', plan: initialPlan, created: [] };

  const created = [];
  for (const candidate of initialPlan.missing) {
    let beforeCreate;
    try {
      // Re-read before each create so collections added by another operator
      // are preserved rather than overwritten.
      beforeCreate = await inspectCollections(inventory, database);
    } catch (error) {
      return {
        mode: created.length ? 'partial' : 'blocked',
        plan: initialPlan,
        created,
        unresolved: error.safeCode || 'COLLECTION_METADATA_UNAVAILABLE',
      };
    }
    if (!beforeCreate.canExecute) {
      return {
        mode: created.length ? 'partial' : 'blocked',
        plan: beforeCreate,
        created,
        unresolved: 'INCOMPATIBLE_COLLECTION_METADATA',
      };
    }
    if (!beforeCreate.missing.some(item => item.collectionName === candidate.collectionName)) {
      continue;
    }

    try {
      await database.createCollection(candidate.collectionName);
    } catch (_) {
      // The command result may be uncertain. Read metadata once and stop; do
      // not retry the create or attempt rollback.
      let failurePlan = beforeCreate;
      try {
        failurePlan = await inspectCollections(inventory, database);
      } catch (_) {
        // Preserve the last verified plan and return only a safe error code.
      }
      return {
        mode: 'partial',
        plan: failurePlan,
        created,
        unresolved: 'COLLECTION_CREATE_OUTCOME_UNKNOWN',
      };
    }

    created.push(candidate.collectionName);
    let afterCreate;
    try {
      afterCreate = await inspectCollections(inventory, database);
    } catch (error) {
      return {
        mode: 'partial',
        plan: beforeCreate,
        created,
        unresolved: error.safeCode || 'POST_CREATE_METADATA_UNAVAILABLE',
      };
    }
    if (!afterCreate.existing.some(item => item.collectionName === candidate.collectionName)) {
      return {
        mode: 'partial',
        plan: afterCreate,
        created,
        unresolved: 'POST_CREATE_VERIFICATION_FAILED',
      };
    }
    if (afterCreate.incompatible.length > 0) {
      return {
        mode: 'partial',
        plan: afterCreate,
        created,
        unresolved: 'INCOMPATIBLE_COLLECTION_METADATA',
      };
    }
  }

  let finalPlan;
  try {
    finalPlan = await inspectCollections(inventory, database);
  } catch (error) {
    return {
      mode: 'partial',
      plan: initialPlan,
      created,
      unresolved: error.safeCode || 'FINAL_METADATA_UNAVAILABLE',
    };
  }
  if (!finalPlan.ready) {
    return { mode: 'partial', plan: finalPlan, created, unresolved: 'FINAL_COLLECTION_VERIFICATION_FAILED' };
  }
  return { mode: 'complete', plan: finalPlan, created };
}

function createDatabaseAdapter(database) {
  if (!database || typeof database.listCollections !== 'function' ||
      typeof database.createCollection !== 'function') {
    fail('COLLECTION_DATABASE_INTERFACE_INVALID');
  }
  return {
    async listCollections() {
      try {
        return await database.listCollections({}, { nameOnly: false }).toArray();
      } catch (_) {
        fail('COLLECTION_METADATA_UNAVAILABLE');
      }
    },
    async createCollection(name) {
      return database.createCollection(name);
    },
  };
}

module.exports = {
  EXPECTED_COLLECTION_INVENTORY,
  assertReviewedCollectionInventory,
  assertTransactionCapableTopology,
  authorizeCollectionInitialization,
  authorizeCollectionTarget,
  createDatabaseAdapter,
  formatTargetIdentity,
  initializeProductionCollections,
  inspectCollections,
  resolveCollectionInventory,
  verifyConnectedIdentityAndTopology,
};
