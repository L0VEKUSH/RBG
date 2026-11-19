'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  assertReviewedCollectionInventory,
  createDatabaseAdapter,
  formatTargetIdentity,
  initializeProductionCollections,
  verifyConnectedIdentityAndTopology,
} = require('../utils/production-collection-initialization');
const {
  parseArguments,
  parseMongoTarget,
} = require('../utils/production-index-provisioning');
const { configureMongooseForEnvironment } = require('../utils/mongoose-connection-options');

function safeErrorCode(error) {
  const candidate = error && error.safeCode;
  return typeof candidate === 'string' && /^[A-Z0-9_-]{1,64}$/.test(candidate)
    ? candidate
    : 'COLLECTION_INITIALIZATION_FAILED';
}

function loadApplicationModels(modelDirectory = path.join(__dirname, '..', 'models')) {
  const files = fs.readdirSync(modelDirectory)
    .filter(file => file.endsWith('.js'))
    .sort();
  if (files.length === 0) {
    const error = new Error('MODEL_INVENTORY_EMPTY');
    error.safeCode = 'MODEL_INVENTORY_EMPTY';
    throw error;
  }
  return files.map(file => require(path.join(modelDirectory, file)));
}

function printPlan(result, target, topology) {
  console.log(`mode=${result.mode} target=${formatTargetIdentity(target)} topology=${topology.type}`);
  for (const item of result.plan.existing) {
    console.log(`  existing model=${item.modelName} collection=${item.collectionName}`);
  }
  for (const item of result.plan.missing) {
    console.log(`  missing model=${item.modelName} collection=${item.collectionName}`);
  }
  for (const item of result.plan.incompatible) {
    console.log(`  incompatible model=${item.modelName} collection=${item.collectionName} type=${item.type}`);
  }
  console.log(
    `existingCount=${result.plan.existing.length} missingCount=${result.plan.missing.length}` +
    ` incompatibleCount=${result.plan.incompatible.length} createdCount=${result.created.length}`
  );
  if (result.unresolved) console.log(`unresolved=${result.unresolved}`);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== 'production') {
    const error = new Error('PRODUCTION_ENVIRONMENT_REQUIRED');
    error.safeCode = 'PRODUCTION_ENVIRONMENT_REQUIRED';
    throw error;
  }

  // Read the secret only from the invoking process environment. Do not load
  // dotenv files, accept a URI on the command line, or print the URI.
  const target = parseMongoTarget(process.env.MONGO_URI);
  const mongoose = require('mongoose');
  const connectionOptions = configureMongooseForEnvironment(mongoose, nodeEnv);
  let connected = false;
  try {
    await mongoose.connect(process.env.MONGO_URI, connectionOptions);
    connected = true;
    const connection = mongoose.connection;
    const { topology, authorization } = await verifyConnectedIdentityAndTopology(connection, {
      args,
      nodeEnv,
      target,
    });
    const inventory = assertReviewedCollectionInventory(loadApplicationModels());
    const database = createDatabaseAdapter(connection.db);
    const result = await initializeProductionCollections(inventory, database, {
      execute: args.execute,
      authorization,
    });
    printPlan(result, target, topology);
    if (result.mode === 'blocked' || result.mode === 'partial') process.exitCode = 1;
  } finally {
    if (connected) await mongoose.disconnect().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Production collection initialization stopped [${safeErrorCode(error)}]`);
    process.exitCode = 1;
  });
}

module.exports = { loadApplicationModels, main };
