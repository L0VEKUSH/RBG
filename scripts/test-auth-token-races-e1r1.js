'use strict';
require('express-async-errors');

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');

if (process.env.NODE_ENV && process.env.NODE_ENV !== 'test') {
  throw new Error('Refusing auth token race tests unless NODE_ENV is test.');
}
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://127.0.0.1';
process.env.TRUST_PROXY_HOPS = '0';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'synthetic-e1r1-auth-test-secret-0123456789';
process.env.JWT_EXPIRE = '1h';
process.env.FRONTEND_URL = 'http://127.0.0.1';

const mongoUri = process.env.MONGO_TEST_URI;
assert(mongoUri, 'MONGO_TEST_URI is required; refusing implicit MongoDB selection');
assert.strictEqual(process.env.ALLOW_E1R1_TEST_WRITES, '1', 'Set ALLOW_E1R1_TEST_WRITES=1 to authorize isolated test writes');
const parsed = new URL(mongoUri);
const databaseName = parsed.pathname.replace(/^\/+/, '');
assert(['localhost', '127.0.0.1', '::1'].includes(parsed.hostname), 'MongoDB tests only permit localhost');
assert(/^erp_security_e1r1_[A-Za-z0-9_-]+$/.test(databaseName), 'Mongo database must be named erp_security_e1r1_*');

const mongoose = require('mongoose');
const express = require('express');
const { errorHandler } = require('../middleware/error.middleware');
const User = require('../models/User');
const authRoutes = require('../routes/auth.routes');
const fixtures = [];

async function request(port, path, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function pendingUser(label) {
  const user = await User.create({
    name: `Synthetic E1R1 ${label}`,
    email: `e1r1-auth-${label}-${crypto.randomBytes(5).toString('hex')}@example.com`,
    password: 'Synthetic-E1R1-Password-2026!',
    role: 'student',
    isActive: label === 'reset',
  });
  fixtures.push(user._id);
  return user;
}

async function raceRequests(port, path, payload) {
  const results = await Promise.all([
    request(port, path, payload),
    request(port, path, payload),
  ]);
  assert.deepStrictEqual(results.map((result) => result.status).sort(), [200, 400]);
  const sequentialReuse = await request(port, path, payload);
  assert.strictEqual(sequentialReuse.status, 400);
}

async function main() {
  await mongoose.connect(mongoUri);
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRoutes);
  app.use(errorHandler);
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });

  try {
    const port = server.address().port;
    const resetUser = await pendingUser('reset');
    const resetToken = resetUser.getResetPasswordToken();
    await resetUser.save({ validateBeforeSave: false });
    await raceRequests(port, '/api/v1/auth/reset-password', {
      token: resetToken,
      password: 'Atomic-Reset-Synthetic-2026!',
    });
    const resetSaved = await User.findById(resetUser._id).select('+password');
    assert.strictEqual(await resetSaved.matchPassword('Atomic-Reset-Synthetic-2026!'), true);
    assert.strictEqual(resetSaved.resetPasswordToken, undefined);

    const activationUser = await pendingUser('activation');
    const activationToken = activationUser.getActivationToken();
    await activationUser.save({ validateBeforeSave: false });
    await raceRequests(port, '/api/v1/auth/activate', {
      token: activationToken,
      password: 'Atomic-Activate-Synthetic-2026!',
    });
    const activationSaved = await User.findById(activationUser._id).select('+password');
    assert.strictEqual(activationSaved.isActive, true);
    assert.strictEqual(activationSaved.isEmailVerified, true);
    assert.strictEqual(await activationSaved.matchPassword('Atomic-Activate-Synthetic-2026!'), true);
    assert.strictEqual(activationSaved.activationToken, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('PASS HTTP concurrent and sequential reset/activation token consumption');
}

main().catch((error) => {
  const message = String(error.message || 'Auth token race test failed')
    .replace(/(?:mongodb(?:\+srv)?|rediss?):\/\/\S+/gi, '[connection URI]');
  console.error(message);
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState === 1) {
    await User.deleteMany({ _id: { $in: fixtures } }).catch(() => {});
  }
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
});
