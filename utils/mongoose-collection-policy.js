'use strict';

const { assertReviewedCollectionInventory } = require('./production-model-inventory');

function preflightError(safeCode, properties = {}) {
  const error = new Error(safeCode);
  error.name = 'MongoCollectionPreflightError';
  error.safeCode = safeCode;
  Object.assign(error, properties);
  return error;
}

async function assertRequiredCollectionsPresent(models, database) {
  const inventory = assertReviewedCollectionInventory(models);
  if (!database || typeof database.listCollections !== 'function') {
    throw preflightError('COLLECTION_METADATA_UNAVAILABLE');
  }

  let metadata;
  try {
    const cursor = database.listCollections({}, { nameOnly: false });
    if (!cursor || typeof cursor.toArray !== 'function') {
      throw new TypeError('Collection metadata cursor is unavailable');
    }
    metadata = await cursor.toArray();
  } catch (_) {
    throw preflightError('COLLECTION_METADATA_UNAVAILABLE');
  }
  if (!Array.isArray(metadata) || metadata.some(item => !item || typeof item.name !== 'string')) {
    throw preflightError('COLLECTION_METADATA_INVALID');
  }

  const metadataByName = new Map(metadata.map(item => [item.name, item]));
  const missingCollections = [];
  const incompatibleCollections = [];
  for (const item of inventory) {
    const actual = metadataByName.get(item.collectionName);
    if (!actual) missingCollections.push(item.collectionName);
    else if (actual.type !== 'collection') incompatibleCollections.push(item.collectionName);
  }

  if (missingCollections.length) {
    throw preflightError('REQUIRED_COLLECTIONS_MISSING', {
      missingCollections: Object.freeze(missingCollections),
    });
  }
  if (incompatibleCollections.length) {
    throw preflightError('REQUIRED_COLLECTIONS_INCOMPATIBLE', {
      incompatibleCollections: Object.freeze(incompatibleCollections),
    });
  }

  return { verifiedCollections: inventory.length };
}

module.exports = { assertRequiredCollectionsPresent };
