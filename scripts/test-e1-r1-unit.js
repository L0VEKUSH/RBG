'use strict';

const assert = require('assert');
const crypto = require('crypto');
const originalEnv = { ...process.env };
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://127.0.0.1';
process.env.TRUST_PROXY_HOPS = '0';
process.env.REDIS_URL = '';
const { validateEncryptionConfig, encryptToken, decryptToken } = require('../utils/tokenMaterial');
const { parseRedisUrl } = require('../queues/redis.connection');
const { classifySmtpError } = require('../utils/sendEmail');

const keys = {
  v1: crypto.randomBytes(32).toString('base64'),
  v2: crypto.randomBytes(32).toString('base64'),
  wrong: crypto.randomBytes(32).toString('base64'),
};
function setEncryptionEnv({ currentVersion = 'v1', currentKey = keys.v1, previousVersion, previousKey } = {}) {
  process.env.NODE_ENV = 'test';
  process.env.EMAIL_ENCRYPTION_KEY_VERSION = currentVersion;
  process.env.EMAIL_ENCRYPTION_KEY = currentKey;
  if (previousVersion) process.env.EMAIL_ENCRYPTION_KEY_PREVIOUS_VERSION = previousVersion;
  else delete process.env.EMAIL_ENCRYPTION_KEY_PREVIOUS_VERSION;
  if (previousKey) process.env.EMAIL_ENCRYPTION_KEY_PREVIOUS = previousKey;
  else delete process.env.EMAIL_ENCRYPTION_KEY_PREVIOUS;
}

try {
  setEncryptionEnv();
  const context = { type: 'activation', userId: 'synthetic-user-id' };
  const oldMaterial = encryptToken('synthetic-token-v1', context);
  assert.strictEqual(oldMaterial.keyVersion, 'v1');
  const legacyFormat = { ...oldMaterial };
  delete legacyFormat.aadVersion;
  assert.throws(() => decryptToken(legacyFormat, context));
  assert.strictEqual(decryptToken(oldMaterial, context), 'synthetic-token-v1');
  assert.throws(() => decryptToken(oldMaterial, { type: 'password_reset', userId: context.userId }));

  setEncryptionEnv({ currentVersion: 'v2', currentKey: keys.v2, previousVersion: 'v1', previousKey: keys.v1 });
  assert.strictEqual(decryptToken(oldMaterial, context), 'synthetic-token-v1');
  const newMaterial = encryptToken('synthetic-token-v2', context);
  assert.strictEqual(newMaterial.keyVersion, 'v2');
  assert.strictEqual(decryptToken(newMaterial, context), 'synthetic-token-v2');
  assert.throws(() => decryptToken(oldMaterial, { type: 'activation', userId: 'other-user' }));

  setEncryptionEnv({ currentVersion: 'v2', currentKey: keys.v2, previousVersion: 'v1', previousKey: keys.wrong });
  assert.throws(() => decryptToken(oldMaterial, context), 'wrong prior key must fail authentication');
  assert.throws(() => validateEncryptionConfig({
    NODE_ENV: 'production',
    EMAIL_ENCRYPTION_KEY_VERSION: 'v2',
    EMAIL_ENCRYPTION_KEY: 'short',
  }, true));
  assert.throws(() => validateEncryptionConfig({
    NODE_ENV: 'production',
    EMAIL_ENCRYPTION_KEY_VERSION: '../bad',
    EMAIL_ENCRYPTION_KEY: keys.v2,
  }, true));
  assert.throws(() => validateEncryptionConfig({
    NODE_ENV: 'production',
    EMAIL_ENCRYPTION_KEY_VERSION: 'v2',
    EMAIL_ENCRYPTION_KEY: keys.v2,
    EMAIL_ENCRYPTION_KEY_PREVIOUS_VERSION: 'v1',
  }, true));
  assert.throws(() => validateEncryptionConfig({
    NODE_ENV: 'production',
    EMAIL_ENCRYPTION_KEY_VERSION: 'zero-test',
    EMAIL_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  }, true));
  assert.throws(() => validateEncryptionConfig({
    NODE_ENV: 'production',
    EMAIL_ENCRYPTION_KEY_VERSION: 'repeat-test',
    EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 0x5a).toString('base64'),
  }, true));

  const aclRedis = parseRedisUrl('redis://acl-user:synthetic%3Apass@127.0.0.1:6380/4');
  assert.deepStrictEqual(aclRedis, {
    host: '127.0.0.1', port: 6380, db: 4, username: 'acl-user', password: 'synthetic:pass',
  });
  const tlsRedis = parseRedisUrl('rediss://acl-user:synthetic-pass@cache.example.test:6381/7?servername=redis.example.test');
  assert.strictEqual(tlsRedis.username, 'acl-user');
  assert.strictEqual(tlsRedis.db, 7);
  assert.deepStrictEqual(tlsRedis.tls, { servername: 'redis.example.test' });
  assert.throws(() => parseRedisUrl('redis://localhost/not-a-database'));

  assert.strictEqual(classifySmtpError({ responseCode: 421 }), true);
  assert.strictEqual(classifySmtpError({ responseCode: 550 }), false);
  assert.strictEqual(classifySmtpError({ code: 'ETIMEDOUT' }), true);
  assert.strictEqual(classifySmtpError({ code: 'EAUTH' }), false);
  console.log('PASS encryption/key rotation, Redis URL parsing, and SMTP failure classification');
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}
