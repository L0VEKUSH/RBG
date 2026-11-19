'use strict';

process.env.NODE_ENV = 'test';
delete process.env.EMAIL_ENCRYPTION_KEY;
delete process.env.EMAIL_ENCRYPTION_KEY_VERSION;
delete process.env.EMAIL_ENCRYPTION_KEY_PREVIOUS;
delete process.env.EMAIL_ENCRYPTION_KEY_PREVIOUS_VERSION;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  validateProductionEmailApplicationConfig,
  validateProductionEmailEnvironment,
  validateProductionEmailTransport,
} = require('../utils/email-production-config');

const KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64');
const PREVIOUS_KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 2)).toString('base64');

function validProductionConfig(overrides = {}) {
  return {
    NODE_ENV: 'production',
    EMAIL_TRANSPORT: 'smtp',
    EMAIL_ENCRYPTION_KEY: KEY,
    EMAIL_ENCRYPTION_KEY_VERSION: 'current-v1',
    SMTP_HOST: 'mail.example.test',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'synthetic-unit-user',
    SMTP_PASS: 'synthetic-unit-password',
    FROM_EMAIL: 'no-reply@example.test',
    ...overrides,
  };
}

test('production rejects JSON/test transport before startup', () => {
  assert.throws(
    () => validateProductionEmailTransport({ EMAIL_TRANSPORT: 'json' }, 'production'),
    error => error.safeCode === 'EMAIL_JSON_TRANSPORT_FORBIDDEN'
  );
});

test('production rejects unsupported transports', () => {
  assert.throws(
    () => validateProductionEmailTransport({ EMAIL_TRANSPORT: 'sendmail' }, 'production'),
    error => error.safeCode === 'EMAIL_TRANSPORT_UNSUPPORTED'
  );
});

test('worker configuration reports missing SMTP settings by name only', () => {
  const config = validProductionConfig();
  delete config.SMTP_HOST;
  delete config.SMTP_PORT;
  delete config.SMTP_SECURE;
  delete config.SMTP_USER;
  delete config.SMTP_PASS;
  delete config.FROM_EMAIL;
  assert.throws(
    () => validateProductionEmailEnvironment(config, 'production'),
    error => error.safeCode === 'EMAIL_SMTP_CONFIGURATION_INCOMPLETE' &&
      error.missingSettings.includes('SMTP_HOST') &&
      error.missingSettings.includes('SMTP_PORT') &&
      error.missingSettings.includes('SMTP_SECURE') &&
      error.missingSettings.includes('SMTP_USER or SMTP_EMAIL') &&
      error.missingSettings.includes('SMTP_PASS or SMTP_PASSWORD') &&
      error.missingSettings.includes('FROM_EMAIL') &&
      !error.message.includes('synthetic-unit-password')
  );
});

test('production rejects invalid SMTP port, security mode, and sender identity', () => {
  assert.throws(
    () => validateProductionEmailEnvironment(validProductionConfig({ SMTP_HOST: 'smtp://mail.example.test' }), 'production'),
    error => error.safeCode === 'EMAIL_SMTP_HOST_INVALID'
  );
  assert.throws(
    () => validateProductionEmailEnvironment(validProductionConfig({ SMTP_PORT: '587x' }), 'production'),
    error => error.safeCode === 'EMAIL_SMTP_PORT_INVALID'
  );
  assert.throws(
    () => validateProductionEmailEnvironment(validProductionConfig({ SMTP_SECURE: 'yes' }), 'production'),
    error => error.safeCode === 'EMAIL_SMTP_SECURITY_INVALID'
  );
  assert.throws(
    () => validateProductionEmailEnvironment(validProductionConfig({ FROM_EMAIL: 'invalid sender' }), 'production'),
    error => error.safeCode === 'EMAIL_SENDER_IDENTITY_INVALID'
  );
});

test('valid production SMTP configuration returns no credential or key material', () => {
  const result = validateProductionEmailEnvironment(validProductionConfig(), 'production');
  assert.deepEqual(result, {
    transport: 'smtp',
    smtp: { port: 587, secure: false },
    encryption: { currentVersion: 'current-v1', previousVersion: '' },
  });
  assert.equal(JSON.stringify(result).includes('synthetic-unit-password'), false);
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test('web configuration validates transport and key rotation without requiring worker SMTP settings', () => {
  const config = {
    NODE_ENV: 'production',
    EMAIL_ENCRYPTION_KEY: KEY,
    EMAIL_ENCRYPTION_KEY_VERSION: 'current-v1',
  };
  assert.deepEqual(validateProductionEmailApplicationConfig(config, 'production'), {
    transport: 'smtp',
    encryption: { currentVersion: 'current-v1', previousVersion: '' },
  });
});

test('key rotation requires a valid paired, distinct previous key without exposing material', () => {
  const missingVersion = validProductionConfig({
    EMAIL_ENCRYPTION_KEY_PREVIOUS: PREVIOUS_KEY,
  });
  assert.throws(
    () => validateProductionEmailEnvironment(missingVersion, 'production'),
    error => error.safeCode === 'EMAIL_ENCRYPTION_CONFIGURATION_INVALID' &&
      !error.message.includes(PREVIOUS_KEY)
  );

  const validRotation = validProductionConfig({
    EMAIL_ENCRYPTION_KEY_PREVIOUS: PREVIOUS_KEY,
    EMAIL_ENCRYPTION_KEY_PREVIOUS_VERSION: 'previous-v1',
  });
  assert.equal(
    validateProductionEmailEnvironment(validRotation, 'production').encryption.previousVersion,
    'previous-v1'
  );
});

test('development and test retain JSON transport and do not require SMTP configuration', () => {
  assert.equal(validateProductionEmailTransport({ EMAIL_TRANSPORT: 'json' }, 'test'), 'json');
  assert.deepEqual(validateProductionEmailEnvironment({ EMAIL_TRANSPORT: 'json' }, 'test'), {
    transport: 'json',
  });
});

test('configuration validation contains no SMTP transport or network calls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'email-production-config.js'), 'utf8');
  assert.doesNotMatch(source, /nodemailer|createTransport|sendMail|\.connect\s*\(/);
  const sender = fs.readFileSync(path.join(__dirname, '..', 'utils', 'sendEmail.js'), 'utf8');
  assert.match(sender, /validateProductionEmailTransport\(process\.env, process\.env\.NODE_ENV\)/);
  assert.match(sender, /if \(transport === 'json'\)/);
});

test('shared production config invokes the fail-closed email application validator', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'config', 'env.js'), 'utf8');
  assert.match(source, /validateProductionEmailApplicationConfig\(process\.env, NODE_ENV\)/);
});
