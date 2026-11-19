'use strict';

const { assertRequiredCollectionsPresent } = require('./mongoose-collection-policy');

async function assertProductionDatabaseReady({ models, database, indexCheck }) {
  if (typeof indexCheck !== 'function') {
    throw new TypeError('Production index check is required');
  }
  await assertRequiredCollectionsPresent(models, database);
  await indexCheck(models);
}

module.exports = { assertProductionDatabaseReady };
