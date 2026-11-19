'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  buildUniqueDuplicatePipeline,
  formatTargetIdentity,
  parseArguments,
  parseMongoTarget,
  provisionIndexes,
  authorizeTarget,
  verifyConnectedIdentity,
} = require('../utils/production-index-provisioning');
const { configureMongooseForEnvironment } = require('../utils/mongoose-connection-options');

function safeErrorCode(error) {
  const candidate = error && (error.safeCode || error.name || error.code);
  return typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(candidate)
    ? candidate
    : 'PROVISIONING_FAILED';
}

function loadApplicationModels(mongoose) {
  const modelDirectory = path.join(__dirname, '..', 'models');
  const files = fs.readdirSync(modelDirectory)
    .filter(file => file.endsWith('.js'))
    .sort();
  for (const file of files) require(path.join(modelDirectory, file));
  return Object.values(mongoose.models);
}

function createDatabaseAdapter(database) {
  async function listCollectionNames() {
    const collections = await database.listCollections({}, { nameOnly: true }).toArray();
    return collections.map(collection => collection.name);
  }

  return {
    listCollectionNames,
    async collectionExists(name) {
      return (await listCollectionNames()).includes(name);
    },
    async listIndexes(name) {
      return database.collection(name).listIndexes().toArray();
    },
    async hasDuplicateKeyGroup(name, keys, options) {
      const aggregationOptions = { allowDiskUse: false, maxTimeMS: 30000 };
      if (options.collation) aggregationOptions.collation = options.collation;
      const results = await database.collection(name)
        .aggregate(buildUniqueDuplicatePipeline(keys, options), aggregationOptions)
        .toArray();
      return results.length > 0;
    },
    async createIndex(name, keys, options) {
      if (!await this.collectionExists(name)) {
        const error = new Error('COLLECTION_MISSING');
        error.safeCode = 'COLLECTION_MISSING';
        throw error;
      }
      return database.collection(name).createIndex(keys, options);
    },
  };
}

function printPlan(result, target, topology) {
  console.log(`mode=${result.mode} target=${formatTargetIdentity(target)} topology=${topology.type}`);
  for (const collection of result.plan.collections) {
    console.log(
      `model=${collection.modelName} collection=${collection.collectionName}` +
      ` exists=${collection.collectionExists} present=${collection.present.length}` +
      ` missing=${collection.missing.length}` +
      ` incompatible=${collection.incompatible.length} extra=${collection.extra.length}` +
      ` duplicateKeys=${collection.duplicateKeys.length}`
    );
    for (const index of collection.missing) {
      console.log(`  missing key=${JSON.stringify(index.keys)} options=${JSON.stringify(index.options)}`);
    }
    for (const index of collection.incompatible) {
      console.log(`  incompatible key=${JSON.stringify(index.keys || {})}`);
    }
    for (const index of collection.extra) {
      console.log(`  unmanaged index name=${index.name || 'unnamed'} key=${JSON.stringify(index.key || {})}`);
    }
    for (const index of collection.duplicateKeys) {
      console.log(`  duplicate data blocks unique key=${JSON.stringify(index.keys)}`);
    }
  }
  if (result.unresolved) console.log(`unresolved=${result.unresolved}`);
  if (result.created.length > 0) console.log(`createdIndexCount=${result.created.length}`);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== 'production') {
    const error = new Error('PRODUCTION_ENVIRONMENT_REQUIRED');
    error.safeCode = 'PRODUCTION_ENVIRONMENT_REQUIRED';
    throw error;
  }

  const target = parseMongoTarget(process.env.MONGO_URI);
  authorizeTarget({ args, nodeEnv, target });

  const mongoose = require('mongoose');
  const connectionOptions = configureMongooseForEnvironment(mongoose, nodeEnv);
  let connected = false;
  try {
    await mongoose.connect(process.env.MONGO_URI, connectionOptions);
    connected = true;
    const connection = mongoose.connection;
    const topology = await verifyConnectedIdentity(connection, target, args, nodeEnv);
    const models = loadApplicationModels(mongoose);
    if (models.length === 0) {
      const error = new Error('MODEL_INVENTORY_EMPTY');
      error.safeCode = 'MODEL_INVENTORY_EMPTY';
      throw error;
    }

    const database = createDatabaseAdapter(connection.db);
    const result = await provisionIndexes(models, database, { execute: args.execute });
    printPlan(result, target, topology);
    if (result.mode === 'blocked' || result.mode === 'partial' ||
        (result.mode === 'dry-run' && !result.plan.canExecute)) {
      process.exitCode = 1;
    }
  } finally {
    if (connected) await mongoose.disconnect().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Production index provisioning stopped [${safeErrorCode(error)}]`);
    process.exitCode = 1;
  });
}
