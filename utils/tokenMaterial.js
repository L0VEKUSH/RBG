'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const TEST_KEY = crypto.createHash('sha256').update('erp-test-only-email-key').digest();
const VERSION_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

function parseKey(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error(`${name} must be a base64-encoded 32-byte key`);
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error(`${name} must be a base64-encoded 32-byte key`);
  }
  if (key.every((byte) => byte === key[0])) {
    throw new Error(`${name} must not contain a repeated-byte key pattern`);
  }
  return key;
}

function validateEncryptionConfig(env = process.env, production = env.NODE_ENV === 'production') {
  const currentVersion = env.EMAIL_ENCRYPTION_KEY_VERSION || (production ? '' : 'v1');
  const currentValue = env.EMAIL_ENCRYPTION_KEY;
  const previousVersion = env.EMAIL_ENCRYPTION_KEY_PREVIOUS_VERSION;
  const previousValue = env.EMAIL_ENCRYPTION_KEY_PREVIOUS;

  if (!currentVersion || !VERSION_PATTERN.test(currentVersion)) {
    throw new Error('EMAIL_ENCRYPTION_KEY_VERSION must be a 1-32 character version identifier');
  }
  if (production && !currentValue) {
    throw new Error('EMAIL_ENCRYPTION_KEY is required in production');
  }
  if (currentValue) parseKey(currentValue, 'EMAIL_ENCRYPTION_KEY');
  if (Boolean(previousVersion) !== Boolean(previousValue)) {
    throw new Error('Previous encryption key and version must be configured together');
  }
  if (previousVersion) {
    if (!VERSION_PATTERN.test(previousVersion) || previousVersion === currentVersion) {
      throw new Error('EMAIL_ENCRYPTION_KEY_PREVIOUS_VERSION must be a distinct valid version');
    }
    parseKey(previousValue, 'EMAIL_ENCRYPTION_KEY_PREVIOUS');
  }
  return { currentVersion, previousVersion };
}

function currentVersion() {
  return validateEncryptionConfig(process.env).currentVersion;
}

function keyForVersion(version) {
  const config = validateEncryptionConfig(process.env);
  if (version === config.currentVersion && process.env.EMAIL_ENCRYPTION_KEY) {
    return parseKey(process.env.EMAIL_ENCRYPTION_KEY, 'EMAIL_ENCRYPTION_KEY');
  }
  if (version === config.previousVersion && process.env.EMAIL_ENCRYPTION_KEY_PREVIOUS) {
    return parseKey(process.env.EMAIL_ENCRYPTION_KEY_PREVIOUS, 'EMAIL_ENCRYPTION_KEY_PREVIOUS');
  }
  if (process.env.NODE_ENV === 'test' && !process.env.EMAIL_ENCRYPTION_KEY && version === config.currentVersion) {
    return TEST_KEY;
  }
  throw new Error('Email encryption key version is unavailable');
}

function contextBytes(context) {
  if (!context) return Buffer.alloc(0);
  if (!context.type || !context.userId) throw new Error('Encryption context is incomplete');
  return Buffer.from(`email-delivery:v1:${context.type}:${context.userId}`, 'utf8');
}

function encryptToken(token, context) {
  const version = currentVersion();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, keyForVersion(version), iv);
  cipher.setAAD(contextBytes(context));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: version,
    aadVersion: 1,
  };
}

function decryptToken(material, context) {
  if (!material || !material.keyVersion) throw new Error('Email encryption key version is unavailable');
  if (material.aadVersion !== 1) throw new Error('Legacy email ciphertext requires an offline migration');
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    keyForVersion(material.keyVersion),
    Buffer.from(material.iv, 'base64')
  );
  decipher.setAAD(contextBytes(context));
  decipher.setAuthTag(Buffer.from(material.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(material.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = {
  decryptToken,
  encryptToken,
  KEY_VERSION: currentVersion(),
  validateEncryptionConfig,
};
