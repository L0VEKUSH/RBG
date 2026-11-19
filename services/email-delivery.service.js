'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const EmailDelivery = require('../models/EmailDelivery');
const User = require('../models/User');
const Admission = require('../models/Admission');
const AdmissionSagaAttempt = require('../models/AdmissionSagaAttempt');
const WorkerLease = require('../models/WorkerLease');
const logger = require('../utils/logger');
const { prepareModelIndexes } = require('../utils/mongoose-index-policy');
const { sendEmail } = require('../utils/sendEmail');
const { buildPasswordResetEmail, buildActivationEmail } = require('../utils/emailTemplates');
const { encryptToken, decryptToken } = require('../utils/tokenMaterial');
const { enqueueDelivery } = require('../queues/email.queue');

const MAX_ATTEMPTS = Math.min(20, Math.max(1, Number.parseInt(process.env.EMAIL_MAX_ATTEMPTS, 10) || 5));
const LEASE_MS = Math.max(30000, Number.parseInt(process.env.EMAIL_LEASE_MS, 10) || 120000);
const BACKOFF_MS = Math.max(10, Number.parseInt(process.env.EMAIL_BACKOFF_MS, 10) || 1000);
const RECONCILE_INTERVAL_MS = Math.max(1000, Number.parseInt(process.env.EMAIL_RECONCILE_MS, 10) || 30000);
const DELIVERY_RETENTION_MS = Math.max(60000, Number.parseInt(process.env.EMAIL_DELIVERY_RETENTION_MS, 10) || 30 * 86400000);
const RECONCILIATION_LEASE_ID = 'email-delivery-reconciliation';
const RECONCILIATION_LEASE_MS = Math.max(30000, Number.parseInt(process.env.EMAIL_RECONCILE_LEASE_MS, 10) || 5 * 60 * 1000);
const RECONCILE_PAGE_SIZE = 100;
const RECONCILE_MAX_ROWS_PER_CYCLE = 500;
let emailSender = sendEmail;
let deliveryIndexesPromise;

async function ensureDeliveryIndexes() {
  if (!deliveryIndexesPromise) {
    deliveryIndexesPromise = prepareModelIndexes(EmailDelivery).catch((error) => {
      deliveryIndexesPromise = null;
      throw error;
    });
  }
  await deliveryIndexesPromise;
}

function safeErrorCode(error) {
  const candidate = error && (error.deliveryCode || error.code || error.responseCode || error.name);
  return typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(candidate)
    ? candidate
    : 'DELIVERY_ERROR';
}

function createIdempotencyKey(type, userId, tokenHash) {
  return `${type}:${userId}:${crypto.createHash('sha256').update(tokenHash).digest('hex')}`;
}

async function requeueCurrentDelivery({ type, userId, tokenHash }) {
  await ensureDeliveryIndexes();
  const delivery = await EmailDelivery.findOne({
    idempotencyKey: createIdempotencyKey(type, userId, tokenHash),
  });
  if (!delivery) return null;
  if (process.env.EMAIL_TRANSPORT !== 'json' &&
      ['pending', 'failed'].includes(delivery.status) && delivery.nextAttemptAt <= new Date()) {
    await enqueueDelivery(delivery._id.toString());
  }
  return delivery;
}

async function createDelivery({ type, user, token, tokenHash, tokenExpiresAt, deferEnqueue = false, relatedAdmission, admissionSagaId, admissionSagaGeneration }) {
  await ensureDeliveryIndexes();
  const idempotencyKey = createIdempotencyKey(type, user._id, tokenHash);
  let delivery;
  try {
    delivery = await EmailDelivery.findOneAndUpdate(
      { idempotencyKey },
      {
        $setOnInsert: {
          type,
          user: user._id,
          ...(relatedAdmission && { relatedAdmission }),
          ...(admissionSagaId && { admissionSagaId }),
          ...(admissionSagaGeneration && { admissionSagaGeneration }),
          recipient: user.email,
          idempotencyKey,
          encryptedToken: encryptToken(token, { type, userId: user._id.toString() }),
          tokenExpiresAt,
          purgeAt: new Date(new Date(tokenExpiresAt).getTime() + DELIVERY_RETENTION_MS),
          status: deferEnqueue ? 'staged' : 'pending',
          nextAttemptAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    delivery = await EmailDelivery.findOne({ idempotencyKey });
    if (!delivery) throw error;
  }

  if (!deferEnqueue && process.env.EMAIL_TRANSPORT !== 'json') {
    await enqueueDelivery(delivery._id.toString());
  }
  return delivery;
}

async function releaseStagedDelivery(deliveryId) {
  const candidate = await EmailDelivery.findOne({ _id: deliveryId, status: 'staged' });
  if (!candidate) return null;
  if (candidate.relatedAdmission) {
    const commitState = await admissionDeliveryCommitState(candidate);
    if (commitState !== 'committed') {
      if (commitState === 'invalid') await expireDelivery(candidate._id);
      return null;
    }
  }
  const delivery = await EmailDelivery.findOneAndUpdate(
    {
      _id: deliveryId,
      status: 'staged',
      ...(candidate.admissionSagaId && { admissionSagaId: candidate.admissionSagaId }),
      ...(candidate.admissionSagaGeneration && { admissionSagaGeneration: candidate.admissionSagaGeneration }),
    },
    { $set: { status: 'pending', nextAttemptAt: new Date() } },
    { new: true }
  );
  if (!delivery || process.env.EMAIL_TRANSPORT === 'json') return delivery;
  try {
    await enqueueDelivery(delivery._id.toString());
    await EmailDelivery.updateOne(
      { _id: delivery._id, status: 'pending' },
      { $set: { lastEnqueuedAt: new Date() } }
    );
  } catch (error) {
    logger.error(`Staged email left for reconciliation [${safeErrorCode(error)}]`);
  }
  return delivery;
}

async function releaseStagedDeliveries(deliveryIds) {
  if (!deliveryIds.length) return;
  for (const deliveryId of deliveryIds) {
    await releaseStagedDelivery(deliveryId);
  }
}

function expectedSagaCommitMarker(sagaId, generation) {
  return `${sagaId}:${generation}`;
}

async function admissionDeliveryCommitState(delivery) {
  if (!delivery || !delivery.relatedAdmission || !delivery.admissionSagaId || !delivery.admissionSagaGeneration) return 'invalid';
  const marker = expectedSagaCommitMarker(delivery.admissionSagaId, delivery.admissionSagaGeneration);
  const [attempt, admission] = await Promise.all([
    AdmissionSagaAttempt.findOne({
      sagaId: delivery.admissionSagaId,
      admission: delivery.relatedAdmission,
      ownerGeneration: delivery.admissionSagaGeneration,
    }).select('sagaId ownerGeneration state commitMarker'),
    Admission.exists({
      _id: delivery.relatedAdmission,
      status: 'Admitted',
      createdStudent: { $exists: true },
      'admissionSaga.id': delivery.admissionSagaId,
      'admissionSaga.ownerGeneration': delivery.admissionSagaGeneration,
      'admissionSaga.state': 'committed',
      'admissionSaga.commitMarker': marker,
    }),
  ]);
  if (!attempt) return 'invalid';
  if (attempt.state !== 'committed') {
    return attempt.state === 'preparing' ? 'pending' : 'invalid';
  }
  if (attempt.commitMarker !== marker) return 'invalid';
  if (admission) return 'committed';
  const finalizingAdmission = await Admission.exists({
    _id: delivery.relatedAdmission,
    status: 'Admitting',
    'admissionSaga.id': delivery.admissionSagaId,
    'admissionSaga.ownerGeneration': delivery.admissionSagaGeneration,
    'admissionSaga.state': { $in: ['preparing', 'committed'] },
  });
  return finalizingAdmission ? 'pending' : 'invalid';
}

async function expireDelivery(deliveryId) {
  await EmailDelivery.updateOne({
    _id: deliveryId,
    status: { $in: ['staged', 'pending', 'processing', 'failed', 'dead_letter'] },
  }, {
    $set: { status: 'expired', purgeAt: new Date(Date.now() + DELIVERY_RETENTION_MS) },
    $unset: { encryptedToken: 1, lockToken: 1, lockedAt: 1, leaseUntil: 1 },
  });
}

async function invalidateDelivery({ type, userId, tokenHash }) {
  await EmailDelivery.updateOne(
    { idempotencyKey: createIdempotencyKey(type, userId, tokenHash), status: { $in: ['staged', 'pending', 'failed'] } },
    {
      $set: { status: 'expired', purgeAt: new Date(Date.now() + DELIVERY_RETENTION_MS) },
      $unset: { encryptedToken: 1, lockToken: 1, lockedAt: 1, leaseUntil: 1 },
    }
  );
}

async function acquireReconciliationLease() {
  const ownerId = crypto.randomUUID();
  const now = new Date();
  try {
    const claimed = await WorkerLease.findOneAndUpdate({
      _id: RECONCILIATION_LEASE_ID,
      $or: [
        { leaseUntil: { $lte: now } },
        { ownerId },
      ],
    }, {
      $set: { ownerId, leaseUntil: new Date(now.getTime() + RECONCILIATION_LEASE_MS) },
    }, { new: true, upsert: true });
    if (!claimed) return null;
  } catch (error) {
    // A concurrent first claimant can win the _id insert while this upsert is
    // running. Duplicate key means another reconciler owns the lease.
    if (error.code === 11000) return null;
    throw error;
  }

  let lost = false;
  let renewalInFlight;
  let lastRenewedAt = Date.now();
  const renew = () => {
    if (lost) return Promise.reject(Object.assign(new Error('Reconciliation lease was lost.'), { code: 'RECONCILE_LEASE_LOST' }));
    if (renewalInFlight) return renewalInFlight;
    if (Date.now() - lastRenewedAt < Math.floor(RECONCILIATION_LEASE_MS / 3)) return Promise.resolve();
    renewalInFlight = WorkerLease.updateOne({
      _id: RECONCILIATION_LEASE_ID,
      ownerId,
      leaseUntil: { $gt: new Date() },
    }, {
      $set: { leaseUntil: new Date(Date.now() + RECONCILIATION_LEASE_MS) },
    }).then((result) => {
      if (!result.matchedCount) {
        lost = true;
        throw Object.assign(new Error('Reconciliation lease was lost.'), { code: 'RECONCILE_LEASE_LOST' });
      }
      lastRenewedAt = Date.now();
    }).finally(() => { renewalInFlight = null; });
    return renewalInFlight;
  };
  const timer = setInterval(() => {
    renew().catch((error) => logger.error(`Email reconciliation lease renewal failed [${safeErrorCode(error)}]`));
  }, Math.max(1000, Math.floor(RECONCILIATION_LEASE_MS / 3)));
  timer.unref();

  return {
    async assertOwned() {
      await renew();
    },
    async release() {
      clearInterval(timer);
      await WorkerLease.deleteOne({ _id: RECONCILIATION_LEASE_ID, ownerId });
    },
  };
}

async function updateBoundedPage(filter, update) {
  const rows = await EmailDelivery.find(filter).select('_id').sort({ _id: 1 })
    .limit(RECONCILE_MAX_ROWS_PER_CYCLE).lean();
  if (!rows.length) return;
  await EmailDelivery.updateMany({ ...filter, _id: { $in: rows.map(({ _id }) => _id) } }, update);
}

async function deliverDelivery(delivery, lockToken, renewLease = async () => {}) {
  const ownsLease = { _id: delivery._id, status: 'processing', lockToken };
  const now = new Date();
  if (delivery.tokenExpiresAt <= now) {
    await EmailDelivery.updateOne(ownsLease, {
      $set: { status: 'expired', purgeAt: new Date(Date.now() + DELIVERY_RETENTION_MS) },
      $unset: { encryptedToken: 1, lockToken: 1, lockedAt: 1, leaseUntil: 1 },
    });
    return;
  }

  const user = await User.findById(delivery.user);
  if (!user) throw Object.assign(new Error('Delivery user unavailable'), { code: 'USER_NOT_FOUND', retryable: false });
  let token;
  try {
    token = decryptToken(delivery.encryptedToken, {
      type: delivery.type,
      userId: delivery.user.toString(),
    });
  } catch {
    const error = new Error('Encrypted token is unavailable for this key version.');
    error.code = 'EMAIL_TOKEN_DECRYPTION';
    error.retryable = false;
    error.preserveEncryptedToken = true;
    throw error;
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const currentTokenFilter = delivery.type === 'password_reset'
    ? { resetPasswordToken: tokenHash, resetPasswordExpire: { $gt: now } }
    : { activationToken: tokenHash, activationTokenExpire: { $gt: now } };
  const tokenIsCurrent = await User.exists({ _id: delivery.user, ...currentTokenFilter });
  if (!tokenIsCurrent) {
    await EmailDelivery.updateOne(ownsLease, {
      $set: { status: 'expired', purgeAt: new Date(Date.now() + DELIVERY_RETENTION_MS) },
      $unset: { encryptedToken: 1, lockToken: 1, lockedAt: 1, leaseUntil: 1 },
    });
    return;
  }

  if (delivery.relatedAdmission) {
    const commitState = await admissionDeliveryCommitState(delivery);
    if (commitState === 'pending') {
      throw Object.assign(new Error('Admission commit finalization is still pending.'), {
        code: 'ADMISSION_COMMIT_PENDING',
        retryable: true,
      });
    }
    if (commitState !== 'committed') {
      await EmailDelivery.updateOne(ownsLease, {
        $set: { status: 'expired', purgeAt: new Date(Date.now() + DELIVERY_RETENTION_MS) },
        $unset: { encryptedToken: 1, lockToken: 1, lockedAt: 1, leaseUntil: 1 },
      });
      return;
    }
  }

  const baseUrl = (process.env.FRONTEND_URL || process.env.SCHOOL_WEBSITE || '').replace(/\/+$/, '');
  const email = delivery.type === 'password_reset'
    ? buildPasswordResetEmail({
      name: user.name,
      resetUrl: `${baseUrl}/portal/reset-password.html?token=${encodeURIComponent(token)}`,
      schoolName: process.env.SCHOOL_NAME || 'RBG School',
    })
    : buildActivationEmail({
      name: user.name,
      activationUrl: `${baseUrl}/portal/activate.html?token=${encodeURIComponent(token)}`,
      schoolName: process.env.SCHOOL_NAME || 'RBG School',
    });

  await renewLease();
  const result = await emailSender({ to: delivery.recipient, ...email });
  await EmailDelivery.updateOne(ownsLease, {
    $set: {
      status: 'sent',
      sentAt: new Date(),
      purgeAt: new Date(Date.now() + DELIVERY_RETENTION_MS),
      ...(result && result.messageId ? { providerMessageId: result.messageId } : {}),
    },
    $unset: { encryptedToken: 1, lockToken: 1, lockedAt: 1, leaseUntil: 1 },
  });
}

async function processDelivery(deliveryId) {
  const now = new Date();
  const lockToken = crypto.randomUUID();
  const delivery = await EmailDelivery.findOneAndUpdate(
    {
      _id: deliveryId,
      tokenExpiresAt: { $gt: now },
      nextAttemptAt: { $lte: now },
      $or: [
        { status: { $in: ['pending', 'failed'] } },
        { status: 'processing', leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: { status: 'processing', lockedAt: now, leaseUntil: new Date(Date.now() + LEASE_MS), lockToken },
      $inc: { attempts: 1 },
    },
    { new: true }
  );
  if (!delivery) return;

  let leaseLost = false;
  let renewalInFlight = null;
  const renewLease = () => {
    if (leaseLost) return Promise.reject(Object.assign(new Error('Delivery lease ownership was lost.'), {
      code: 'EMAIL_LEASE_LOST', retryable: false,
    }));
    if (renewalInFlight) return renewalInFlight;
    renewalInFlight = EmailDelivery.updateOne(
        { _id: delivery._id, status: 'processing', lockToken },
        { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } }
      ).then((result) => {
        if (!result.matchedCount) {
          leaseLost = true;
          throw Object.assign(new Error('Delivery lease ownership was lost.'), {
            code: 'EMAIL_LEASE_LOST', retryable: false,
          });
        }
      }).finally(() => { renewalInFlight = null; });
    return renewalInFlight;
  };
  const leaseTimer = setInterval(() => {
    renewLease().catch((error) => logger.error(`Email lease renewal failed [${safeErrorCode(error)}]`));
  }, Math.max(1000, Math.floor(LEASE_MS / 3)));
  leaseTimer.unref();
  try {
    await renewLease();
    await deliverDelivery(delivery, lockToken, renewLease);
  } catch (error) {
    const attempts = delivery.attempts || 1;
    const retryable = error.retryable !== false;
    const dead = !retryable || attempts >= MAX_ATTEMPTS;
    const nextAttemptAt = new Date(Date.now() + Math.min(BACKOFF_MS * (2 ** (attempts - 1)), 3600000));
    const update = {
      $set: dead
        ? { status: 'dead_letter', lastErrorCode: safeErrorCode(error), purgeAt: new Date(Date.now() + DELIVERY_RETENTION_MS) }
        : { status: 'failed', lastErrorCode: safeErrorCode(error), nextAttemptAt },
      $unset: { lockToken: 1, lockedAt: 1, leaseUntil: 1 },
    };
    if (dead && !error.preserveEncryptedToken) update.$unset.encryptedToken = 1;
    const saved = await EmailDelivery.updateOne({ _id: delivery._id, status: 'processing', lockToken }, update);
    if (saved.matchedCount) {
      logger.error(`Email delivery ${dead ? 'dead_letter' : 'failed'} [${delivery.type}] code=${safeErrorCode(error)}`);
    }
    if (!dead && saved.matchedCount) throw error;
  } finally {
    clearInterval(leaseTimer);
  }
}

async function reconcileDeliveriesOnce(assertLease) {
  const now = new Date();
  const staleQueued = new Date(Date.now() - RECONCILE_INTERVAL_MS);
  const retentionDate = new Date(Date.now() + DELIVERY_RETENTION_MS);

  await assertLease();
  await updateBoundedPage(
    { status: { $in: ['staged', 'pending', 'processing', 'failed'] }, tokenExpiresAt: { $lte: now }, encryptedToken: { $exists: true } },
    {
      $set: { status: 'expired', purgeAt: retentionDate },
      $unset: { encryptedToken: 1, lockToken: 1, lockedAt: 1, leaseUntil: 1 },
    }
  );

  let lastStagedId = null;
  let stagedScanned = 0;
  while (stagedScanned < RECONCILE_MAX_ROWS_PER_CYCLE) {
    await assertLease();
    const filter = { status: 'staged', relatedAdmission: { $exists: true } };
    if (lastStagedId) filter._id = { $gt: lastStagedId };
    const staged = await EmailDelivery.find(filter)
      .select('_id relatedAdmission admissionSagaId admissionSagaGeneration')
      .sort({ _id: 1 })
      .limit(Math.min(RECONCILE_PAGE_SIZE, RECONCILE_MAX_ROWS_PER_CYCLE - stagedScanned));
    if (!staged.length) break;
    stagedScanned += staged.length;
    lastStagedId = staged[staged.length - 1]._id;
    for (const item of staged) {
      await assertLease();
      const commitState = await admissionDeliveryCommitState(item);
      if (commitState === 'committed') {
        await releaseStagedDelivery(item._id);
        continue;
      }
      if (commitState === 'invalid') await expireDelivery(item._id);
    }
  }
  let lastSagaDeliveryId = null;
  let sagaDeliveriesScanned = 0;
  while (sagaDeliveriesScanned < RECONCILE_MAX_ROWS_PER_CYCLE) {
    await assertLease();
    const filter = {
      status: { $in: ['pending', 'processing', 'failed'] },
      relatedAdmission: { $exists: true },
      admissionSagaId: { $exists: true },
    };
    if (lastSagaDeliveryId) filter._id = { $gt: lastSagaDeliveryId };
    const sagaDeliveries = await EmailDelivery.find(filter)
      .select('_id relatedAdmission admissionSagaId admissionSagaGeneration status')
      .sort({ _id: 1 })
      .limit(Math.min(RECONCILE_PAGE_SIZE, RECONCILE_MAX_ROWS_PER_CYCLE - sagaDeliveriesScanned));
    if (!sagaDeliveries.length) break;
    sagaDeliveriesScanned += sagaDeliveries.length;
    lastSagaDeliveryId = sagaDeliveries[sagaDeliveries.length - 1]._id;
    for (const item of sagaDeliveries) {
      await assertLease();
      if ((await admissionDeliveryCommitState(item)) === 'invalid') await expireDelivery(item._id);
    }
  }
  await assertLease();
  await updateBoundedPage(
    { status: 'dead_letter', encryptedToken: { $exists: true }, lastErrorCode: { $ne: 'EMAIL_TOKEN_DECRYPTION' } },
    { $unset: { encryptedToken: 1 }, $set: { purgeAt: retentionDate } }
  );
  await assertLease();
  await updateBoundedPage(
    { status: { $in: ['sent', 'dead_letter', 'expired'] }, purgeAt: { $exists: false } },
    { $set: { purgeAt: retentionDate } }
  );
  await assertLease();
  await updateBoundedPage(
    { status: 'processing', leaseUntil: { $lte: now } },
    { $set: { status: 'failed', nextAttemptAt: now }, $unset: { lockToken: 1, lockedAt: 1, leaseUntil: 1 } }
  );

  await assertLease();
  const eligible = await EmailDelivery.find({
    status: { $in: ['pending', 'failed'] },
    nextAttemptAt: { $lte: now },
    tokenExpiresAt: { $gt: now },
    $or: [{ lastEnqueuedAt: { $exists: false } }, { lastEnqueuedAt: { $lte: staleQueued } }],
  }).select('_id').sort({ nextAttemptAt: 1, _id: 1 }).limit(100);

  for (const item of eligible) {
    await assertLease();
    try {
      await enqueueDelivery(item._id.toString());
      await EmailDelivery.updateOne(
        { _id: item._id, status: { $in: ['pending', 'failed'] } },
        { $set: { lastEnqueuedAt: new Date() } }
      );
    } catch (error) {
      logger.error(`Email reconciliation enqueue failed [${safeErrorCode(error)}]`);
    }
  }
}

let reconciliationPromise;
function reconcileDeliveries() {
  if (reconciliationPromise) return reconciliationPromise;
  reconciliationPromise = (async () => {
    const lease = await acquireReconciliationLease();
    if (!lease) return { skipped: true, reason: 'another_reconciler_owns_lease' };
    try {
      await reconcileDeliveriesOnce(lease.assertOwned);
      return { skipped: false };
    } finally {
      await lease.release();
    }
  })().finally(() => {
    reconciliationPromise = null;
  });
  return reconciliationPromise;
}

function setEmailSenderForTests(sender) {
  emailSender = sender || sendEmail;
}

module.exports = {
  createDelivery,
  deliverDelivery,
  invalidateDelivery,
  MAX_ATTEMPTS,
  processDelivery,
  requeueCurrentDelivery,
  reconcileDeliveries,
  releaseStagedDelivery,
  releaseStagedDeliveries,
  setEmailSenderForTests,
  ...(process.env.NODE_ENV === 'test'
    ? { acquireReconciliationLeaseForTests: acquireReconciliationLease }
    : {}),
};
