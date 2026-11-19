'use strict';

const assert = require('assert');
const crypto = require('crypto');

if (process.env.NODE_ENV && process.env.NODE_ENV !== 'test') {
  throw new Error('Refusing E1-R1 integration tests unless NODE_ENV is test.');
}
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://127.0.0.1';
process.env.TRUST_PROXY_HOPS = '0';
process.env.EMAIL_TRANSPORT = '';
process.env.EMAIL_MAX_ATTEMPTS = '3';
process.env.EMAIL_BACKOFF_MS = '10';
process.env.EMAIL_LEASE_MS = '1000';
process.env.EMAIL_RECONCILE_MS = '1000';
process.env.EMAIL_DELIVERY_RETENTION_MS = '60000';
process.env.EMAIL_ENCRYPTION_KEY_VERSION = 'e1r1-test';
process.env.EMAIL_ENCRYPTION_KEY = crypto.createHash('sha256').update('synthetic-e1r1-only-key').digest('base64');

const mongoUri = process.env.MONGO_TEST_URI;
const redisUrl = process.env.REDIS_TEST_URL;
assert(mongoUri, 'MONGO_TEST_URI is required; refusing implicit MongoDB selection');
assert(redisUrl, 'REDIS_TEST_URL is required; refusing implicit Redis selection');
assert.strictEqual(process.env.ALLOW_E1R1_TEST_WRITES, '1', 'Set ALLOW_E1R1_TEST_WRITES=1 to authorize isolated test writes');
assert.strictEqual(process.env.ALLOW_E1R1_REDIS_WRITES, '1', 'Set ALLOW_E1R1_REDIS_WRITES=1 to authorize isolated Redis queue writes');

const mongo = new URL(mongoUri);
const databaseName = mongo.pathname.replace(/^\/+/, '');
assert(['localhost', '127.0.0.1', '::1'].includes(mongo.hostname), 'MongoDB tests only permit localhost');
assert(/^erp_security_e1r1_[A-Za-z0-9_-]+$/.test(databaseName), 'Mongo database must be named erp_security_e1r1_*');
const redis = new URL(redisUrl);
assert(['localhost', '127.0.0.1', '::1'].includes(redis.hostname), 'Redis tests only permit localhost');
assert(/^\/\d+$/.test(redis.pathname), 'Redis test URL must select an explicit database number');

const runId = (process.env.E1R1_TEST_RUN_ID || crypto.randomBytes(8).toString('hex'));
assert(/^[A-Za-z0-9_-]{4,40}$/.test(runId), 'E1R1_TEST_RUN_ID must be 4-40 safe characters');
process.env.EMAIL_QUEUE_PREFIX = `erp-e1r1-${runId}:`;
process.env.REDIS_URL = redisUrl;

const mongoose = require('mongoose');
const { createClient } = require('redis');
const { Worker } = require('bullmq');
const User = require('../models/User');
const EmailDelivery = require('../models/EmailDelivery');
const {
  createDelivery,
  MAX_ATTEMPTS,
  processDelivery,
  reconcileDeliveries,
  setEmailSenderForTests,
} = require('../services/email-delivery.service');
const { closeQueue, enqueueDelivery, prefix, queue } = require('../queues/email.queue');

const testUsers = [];
const testDeliveries = [];
let testWorker;
let redisClient;

async function createUser(label) {
  const user = await User.create({
    name: `Synthetic E1R1 ${runId} ${label}`,
    email: `e1r1-${runId}-${label}-${crypto.randomBytes(3).toString('hex')}@example.com`,
    password: 'Synthetic-E1R1-Password-2026!',
    role: 'student',
    isActive: label !== 'pending',
  });
  testUsers.push(user._id);
  return user;
}

async function createCurrentDelivery(type, user, token, expiresAt = new Date(Date.now() + 600000), deferEnqueue = false) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const tokenFields = type === 'password_reset'
    ? { resetPasswordToken: tokenHash, resetPasswordExpire: expiresAt }
    : { activationToken: tokenHash, activationTokenExpire: expiresAt };
  await User.updateOne({ _id: user._id }, { $set: tokenFields });
  const delivery = await createDelivery({ type, user, token, tokenHash, tokenExpiresAt: expiresAt, deferEnqueue });
  testDeliveries.push(delivery._id);
  return delivery;
}

async function removeOwnQueueJob(deliveryId) {
  const job = await queue.getJob(`delivery-${deliveryId}`);
  if (job) await job.remove();
}

async function main() {
  await mongoose.connect(mongoUri);
  redisClient = createClient({ url: redisUrl });
  redisClient.on('error', () => {});
  await redisClient.connect();
  assert.strictEqual(await redisClient.ping(), 'PONG');
  assert(queue, 'BullMQ queue must be configured from REDIS_TEST_URL');

  let successCalls = 0;
  setEmailSenderForTests(async () => {
    successCalls += 1;
    return { messageId: 'synthetic-e1r1-message' };
  });
  const successUser = await createUser('success');
  const successToken = 'synthetic-e1r1-reset-token';
  const success = await createCurrentDelivery('password_reset', successUser, successToken);
  const successHash = crypto.createHash('sha256').update(successToken).digest('hex');
  const duplicate = await createDelivery({
    type: 'password_reset', user: successUser, token: successToken, tokenHash: successHash,
    tokenExpiresAt: new Date(Date.now() + 600000),
  });
  assert.strictEqual(duplicate._id.toString(), success._id.toString(), 'Idempotency key should return the same outbox row');
  const job = await queue.getJob(`delivery-${success._id}`);
  assert(job, 'A delivery should be represented by a BullMQ job');
  assert.deepStrictEqual(Object.keys(job.data), ['deliveryId']);
  assert(!JSON.stringify(job.data).includes(successToken));
  await processDelivery(success._id);
  const sent = await EmailDelivery.findById(success._id).lean();
  assert.strictEqual(sent.status, 'sent');
  assert.strictEqual(sent.encryptedToken, undefined);
  assert.strictEqual(successCalls, 1);
  await removeOwnQueueJob(success._id);

  let concurrentCalls = 0;
  setEmailSenderForTests(async () => {
    concurrentCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { messageId: 'synthetic-concurrent' };
  });
  const concurrentUser = await createUser('concurrent');
  const concurrent = await createCurrentDelivery('activation', concurrentUser, 'synthetic-e1r1-activation-token');
  await Promise.all([processDelivery(concurrent._id), processDelivery(concurrent._id)]);
  assert.strictEqual(concurrentCalls, 1, 'Only the lease owner may enter the sender');
  assert.strictEqual((await EmailDelivery.findById(concurrent._id)).status, 'sent');
  await removeOwnQueueJob(concurrent._id);

  let staleCalls = 0;
  setEmailSenderForTests(async () => { staleCalls += 1; });
  const staleUser = await createUser('stale');
  const stale = await createCurrentDelivery('activation', staleUser, 'synthetic-old-activation-token');
  await User.updateOne({ _id: staleUser._id }, { $set: { activationToken: 'newer-token-hash' } });
  await processDelivery(stale._id);
  assert.strictEqual(staleCalls, 0, 'A stale token must not be sent');
  assert.strictEqual((await EmailDelivery.findById(stale._id)).status, 'expired');
  assert.strictEqual((await EmailDelivery.findById(stale._id)).encryptedToken, undefined);
  await removeOwnQueueJob(stale._id);

  setEmailSenderForTests(async () => {
    const error = new Error('synthetic transient SMTP failure');
    error.code = 'EHOSTUNREACH';
    error.retryable = true;
    throw error;
  });
  testWorker = new Worker('erp-email-delivery', (bullJob) => processDelivery(bullJob.data.deliveryId), {
    connection: require('../queues/redis.connection').connection,
    prefix,
    concurrency: 1,
  });
  await testWorker.waitUntilReady();
  let retry;
  const workerFailed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for the isolated worker failure')), 10000);
    testWorker.on('failed', (failedJob) => {
      if (retry && failedJob && failedJob.id === `delivery-${retry._id}`) {
        clearTimeout(timeout);
        resolve();
      }
    });
    testWorker.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  const retryUser = await createUser('worker-retry');
  retry = await createCurrentDelivery('activation', retryUser, 'synthetic-worker-retry-token', new Date(Date.now() + 600000), true);
  await enqueueDelivery(retry._id.toString());
  await workerFailed;
  assert.strictEqual((await EmailDelivery.findById(retry._id)).status, 'failed');
  assert(!(await queue.getJob(`delivery-${retry._id}`)),
    'BullMQ failed job should be removed so deterministic ID can be re-enqueued');
  await EmailDelivery.updateOne({ _id: retry._id }, {
    $set: { nextAttemptAt: new Date(0), lastEnqueuedAt: new Date(0) },
  });
  await reconcileDeliveries();
  assert(await queue.getJob(`delivery-${retry._id}`), 'Mongo reconciliation should re-enqueue a removed failed job');
  await removeOwnQueueJob(retry._id);
  await testWorker.close();
  testWorker = null;

  await EmailDelivery.updateOne({ _id: retry._id }, {
    $set: { status: 'processing', lockedAt: new Date(Date.now() - 5000), leaseUntil: new Date(0), nextAttemptAt: new Date(0) },
    $unset: { lastEnqueuedAt: 1 },
  });
  await reconcileDeliveries();
  assert.strictEqual((await EmailDelivery.findById(retry._id)).status, 'failed');
  assert(await queue.getJob(`delivery-${retry._id}`), 'Expired processing lease should be reconciled and re-enqueued');
  await removeOwnQueueJob(retry._id);

  setEmailSenderForTests(async () => {
    const error = new Error('synthetic transient SMTP failure');
    error.code = 'ETIMEDOUT';
    error.retryable = true;
    throw error;
  });
  const deadUser = await createUser('dead-letter');
  const dead = await createCurrentDelivery('activation', deadUser, 'synthetic-dead-letter-token');
  await removeOwnQueueJob(dead._id);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    await EmailDelivery.updateOne({ _id: dead._id }, { $set: { nextAttemptAt: new Date(0) } });
    try { await processDelivery(dead._id); } catch { /* assert persisted retry state below */ }
  }
  const deadRow = await EmailDelivery.findById(dead._id).lean();
  assert.strictEqual(deadRow.status, 'dead_letter');
  assert.strictEqual(deadRow.encryptedToken, undefined);

  const expiredUser = await createUser('expired');
  const expired = await createCurrentDelivery('password_reset', expiredUser, 'synthetic-expired-token', new Date(Date.now() - 1));
  await reconcileDeliveries();
  const expiredRow = await EmailDelivery.findById(expired._id).lean();
  assert.strictEqual(expiredRow.status, 'expired');
  assert.strictEqual(expiredRow.encryptedToken, undefined);

  await EmailDelivery.updateOne({ _id: dead._id }, {
    $set: { status: 'dead_letter', encryptedToken: deadRow.encryptedToken || {
      ciphertext: 'synthetic', iv: 'synthetic', authTag: 'synthetic', keyVersion: 'e1r1-test', aadVersion: 1,
    } },
    $unset: { purgeAt: 1 },
  });
  await reconcileDeliveries();
  const cleanedDead = await EmailDelivery.findById(dead._id).lean();
  assert.strictEqual(cleanedDead.encryptedToken, undefined);
  assert(cleanedDead.purgeAt instanceof Date, 'Dead-letter rows must receive bounded retention');

  const keyMismatchUser = await createUser('key-mismatch');
  const keyMismatch = await createCurrentDelivery('activation', keyMismatchUser, 'synthetic-wrong-key-token');
  await removeOwnQueueJob(keyMismatch._id);
  const correctKey = process.env.EMAIL_ENCRYPTION_KEY;
  process.env.EMAIL_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  await processDelivery(keyMismatch._id);
  process.env.EMAIL_ENCRYPTION_KEY = correctKey;
  const keyMismatchRow = await EmailDelivery.findById(keyMismatch._id).lean();
  assert.strictEqual(keyMismatchRow.status, 'dead_letter');
  assert(keyMismatchRow.encryptedToken, 'Unreadable ciphertext must remain available for repair during bounded retention');
  await reconcileDeliveries();
  assert((await EmailDelivery.findById(keyMismatch._id).lean()).encryptedToken);

  console.log('PASS isolated outbox, worker lease, stale-token check, retry/dead-letter, reconciliation, and ciphertext cleanup');
}

main().catch((error) => {
  const message = String(error.message || 'E1-R1 integration test failed')
    .replace(/(?:mongodb(?:\+srv)?|rediss?):\/\/\S+/gi, '[connection URI]');
  console.error(message);
  process.exitCode = 1;
}).finally(async () => {
  setEmailSenderForTests(null);
  if (testWorker) await testWorker.close().catch(() => {});
  for (const deliveryId of testDeliveries) await removeOwnQueueJob(deliveryId).catch(() => {});
  if (mongoose.connection.readyState === 1) {
    await EmailDelivery.deleteMany({ _id: { $in: testDeliveries } }).catch(() => {});
    await User.deleteMany({ _id: { $in: testUsers } }).catch(() => {});
  }
  if (redisClient && redisClient.isOpen) await redisClient.quit().catch(() => {});
  await closeQueue().catch(() => {});
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
});
