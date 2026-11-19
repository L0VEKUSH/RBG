const assert = require('assert');
const crypto = require('crypto');
const mongoose = require('mongoose');

const uri = process.env.MONGO_TEST_URI;
const prefix = 'erp_security_phasec_';
assert(uri, 'MONGO_TEST_URI is required');
const parsed = new URL(uri);
const database = parsed.pathname.replace(/^\/+/, '');
assert(['localhost', '127.0.0.1', '::1'].includes(parsed.hostname), 'Only localhost MongoDB is permitted');
assert(database.startsWith(prefix), `Database must start with ${prefix}`);
assert(!process.env.NODE_ENV || process.env.NODE_ENV === 'test', 'NODE_ENV must be test');
assert.strictEqual(process.env.ALLOW_PHASEC_TEST_DB_DROP, '1',
  'Set ALLOW_PHASEC_TEST_DB_DROP=1 to authorize destructive Phase C test cleanup');

process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'http://127.0.0.1:5189';
process.env.EMAIL_TRANSPORT = 'json';

const User = require('../models/User');
const authService = require('../services/auth.service');

const password = 'Synthetic-Phase-C-Password-2026!';

async function createPendingUser() {
  return User.create({
    name: 'Synthetic Activation User',
    email: `phase-c-${crypto.randomBytes(4).toString('hex')}@example.com`,
    password: 'Unusable-Random-Password-2026!',
    role: 'student',
    isActive: false,
    isEmailVerified: false,
  });
}

async function testActivation() {
  const user = await createPendingUser();
  const token = user.getActivationToken();
  await user.save({ validateBeforeSave: false });
  const stored = await User.findById(user._id).select('+password');
  assert.notStrictEqual(stored.activationToken, token, 'Activation plaintext must not be stored');
  assert.strictEqual(stored.activationToken.length, 64, 'Activation hash must be SHA-256');

  await authService.activateAccount(token, password);
  const activated = await User.findById(user._id).select('+password');
  assert.strictEqual(activated.isActive, true);
  assert.strictEqual(activated.isEmailVerified, true);
  assert.strictEqual(activated.activationToken, undefined);
  assert.strictEqual(await activated.matchPassword(password), true);

  await assert.rejects(
    authService.activateAccount(token, password),
    (error) => error.statusCode === 400
  );
  await assert.rejects(
    authService.activateAccount('malformed-token', password),
    (error) => error.statusCode === 400
  );
}

async function testExpiryAndResetSessionInvalidation() {
  const user = await User.create({
    name: 'Synthetic Reset User',
    email: `phase-c-reset-${crypto.randomBytes(4).toString('hex')}@example.com`,
    password,
    role: 'student',
    isActive: true,
    isEmailVerified: true,
  });
  const resetToken = user.getResetPasswordToken();
  await user.save({ validateBeforeSave: false });
  const beforeVersion = user.tokenVersion;
  await authService.resetPassword(resetToken, 'New-Synthetic-Password-2026!');
  const reset = await User.findById(user._id).select('+password');
  assert.strictEqual(reset.resetPasswordToken, undefined);
  assert.strictEqual(reset.tokenVersion, beforeVersion + 1);
  assert.strictEqual(await reset.matchPassword('New-Synthetic-Password-2026!'), true);

  await assert.rejects(
    authService.resetPassword(resetToken, password),
    (error) => error.statusCode === 400
  );

  const expired = await createPendingUser();
  const expiredToken = expired.getActivationToken();
  expired.activationTokenExpire = Date.now() - 1;
  await expired.save({ validateBeforeSave: false });
  await assert.rejects(
    authService.activateAccount(expiredToken, password),
    (error) => error.statusCode === 400
  );
  assert.strictEqual((await User.findById(expired._id)).isActive, false);
}

async function main() {
  await mongoose.connect(uri);
  await User.deleteMany({});
  await testActivation();
  await testExpiryAndResetSessionInvalidation();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log('All Phase C authentication tests passed against isolated MongoDB');
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect();
  process.exitCode = 1;
});
