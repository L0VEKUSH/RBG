'use strict';

const LOCAL_MONGO_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function assertLocalSyntheticSeedTarget({
  env = process.env,
  expectedEnvironment,
  optInVariable,
  databaseName,
}) {
  if (env.NODE_ENV !== expectedEnvironment) {
    throw new Error(`Seeding requires NODE_ENV=${expectedEnvironment}.`);
  }
  if (env[optInVariable] !== '1') {
    throw new Error(`Seeding requires explicit ${optInVariable}=1 opt-in.`);
  }
  if (!env.MONGO_URI) {
    throw new Error('An explicit local MONGO_URI is required for seeding.');
  }

  let parsed;
  try {
    parsed = new URL(env.MONGO_URI);
  } catch {
    throw new Error('MONGO_URI is malformed.');
  }

  if (parsed.protocol !== 'mongodb:' || !LOCAL_MONGO_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Demo seeding is restricted to a local MongoDB instance.');
  }

  const actualDatabase = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0]);
  if (actualDatabase !== databaseName) {
    throw new Error(`Demo seeding requires the isolated ${databaseName} database.`);
  }

  return env.MONGO_URI;
}

module.exports = { assertLocalSyntheticSeedTarget };
