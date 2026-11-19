'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const Admission = require('../models/Admission');
const AdmissionSagaAttempt = require('../models/AdmissionSagaAttempt');
const User = require('../models/User');
const Student = require('../models/Student');
const Class = require('../models/Class');
const Parent = require('../models/Parent');
const StudentFee = require('../models/StudentFee');
const FeeStructure = require('../models/FeeStructure');
const Counter = require('../models/Counter');
const EmailDelivery = require('../models/EmailDelivery');
const authService = require('./auth.service');
const { releaseStagedDeliveries } = require('./email-delivery.service');
const logger = require('../utils/logger');
const ErrorResponse = require('../utils/errorResponse');
const { resolveEffectiveDate } = require('./enrollment-date.service');
const { schoolDateKey } = require('../utils/attendance-date');
const { prepareModelIndexes } = require('../utils/mongoose-index-policy');

/*
 * This workflow is a saga, not a cross-collection transaction. The attempt
 * document's generation CAS fences ownership and commit; created records and
 * parent-child links carry saga/generation metadata. A write already past its
 * ownership check can finish after recovery, so tombstone cleanup repeats.
 * Email requires the durable commit marker in both the attempt and admission.
 * Recovery must keep running; missing or incomplete journals stay quarantined
 * for manual review. Counter gaps are tolerated rather than decremented.
 */
const SAGA_LEASE_MS = Math.max(60000, Number.parseInt(process.env.ADMISSION_SAGA_LEASE_MS, 10) || 5 * 60 * 1000);
const ORPHAN_RECHECK_MS = Math.max(60000, Number.parseInt(process.env.ADMISSION_SAGA_ORPHAN_RECHECK_MS, 10) || 5 * 60 * 1000);
const RECOVERY_BATCH_SIZE = 50;
const OWNED_PARENT_FIELDS = '+admissionSagaId +admissionSagaGeneration +admissionSagaOwnership';

let sagaTestHook = null;
let recoveryPromise;
let indexesPromise;

async function ensureSagaIndexes() {
  if (!indexesPromise) {
    indexesPromise = Promise.all([
      prepareModelIndexes(AdmissionSagaAttempt),
      prepareModelIndexes(Admission),
      prepareModelIndexes(User),
      prepareModelIndexes(Student),
      prepareModelIndexes(Parent),
      prepareModelIndexes(StudentFee),
      prepareModelIndexes(EmailDelivery),
    ]).catch((error) => {
      indexesPromise = null;
      throw error;
    });
  }
  await indexesPromise;
}

async function runSagaTestHook(point, context) {
  if (process.env.NODE_ENV === 'test' && sagaTestHook) await sagaTestHook(point, context);
}

function attemptFilter(admissionId, sagaId, ownerId, generation, state = 'preparing') {
  return {
    admission: admissionId,
    sagaId,
    ownerId,
    ownerGeneration: generation,
    state,
    leaseUntil: { $gt: new Date() },
  };
}

function admissionPointerFilter(admissionId, sagaId, ownerId, generation, states = ['preparing']) {
  return {
    _id: admissionId,
    status: 'Admitting',
    'admissionSaga.id': sagaId,
    'admissionSaga.ownerId': ownerId,
    'admissionSaga.ownerGeneration': generation,
    'admissionSaga.state': { $in: states },
  };
}

function attemptPath(path) {
  if (path === 'admissionSaga.parentLink') return 'resources.parentLink';
  if (path.startsWith('admissionSaga.resources.')) return path.replace('admissionSaga.resources.', 'resources.');
  if (path === 'admissionSaga.activationTokens') return 'activationTokens';
  return null;
}

function mapAttemptFields(fields) {
  const mapped = {};
  for (const [path, value] of Object.entries(fields || {})) {
    const target = attemptPath(path);
    if (target) mapped[target] = value;
  }
  return mapped;
}

function mapAttemptAddToSet(fields) {
  const mapped = {};
  for (const [path, value] of Object.entries(fields || {})) {
    const target = attemptPath(path);
    if (target) mapped[target] = value;
  }
  return mapped;
}

async function assertSagaOwnership(admissionId, sagaId, ownerId, generation, phase) {
  const [attempt, admission] = await Promise.all([
    AdmissionSagaAttempt.exists(attemptFilter(admissionId, sagaId, ownerId, generation)),
    Admission.exists(admissionPointerFilter(admissionId, sagaId, ownerId, generation)),
  ]);
  if (!attempt || !admission) throw new Error('Admission saga ownership or generation was lost');
  await runSagaTestHook(`after:ownership-validated:${phase}`, {
    admissionId, sagaId, ownerId, generation, phase,
  });
}

async function checkpointSaga(admissionId, sagaId, ownerId, generation, step, fields = {}, addToSet = {}) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + SAGA_LEASE_MS);
  const attemptSet = {
    step,
    updatedAt: now,
    leaseUntil,
    ...mapAttemptFields(fields),
  };
  const attemptAddToSet = mapAttemptAddToSet(addToSet);
  const attemptUpdate = { $set: attemptSet };
  if (Object.keys(attemptAddToSet).length) attemptUpdate.$addToSet = attemptAddToSet;
  const attempt = await AdmissionSagaAttempt.updateOne(
    { ...attemptFilter(admissionId, sagaId, ownerId, generation), state: 'preparing' },
    attemptUpdate
  );
  if (!attempt.matchedCount) throw new Error('Admission saga attempt ownership was lost');

  const admissionSet = {
    'admissionSaga.step': step,
    'admissionSaga.updatedAt': now,
    'admissionSaga.leaseUntil': leaseUntil,
    ...fields,
  };
  const admissionUpdate = { $set: admissionSet };
  if (Object.keys(addToSet).length) admissionUpdate.$addToSet = addToSet;
  const mirrored = await Admission.updateOne(
    admissionPointerFilter(admissionId, sagaId, ownerId, generation),
    admissionUpdate
  );
  if (!mirrored.matchedCount) throw new Error('Admission saga admission pointer was lost');
  await runSagaTestHook(`checkpoint:${step}`, { admissionId, sagaId, generation });
}

function startSagaHeartbeat(admissionId, sagaId, ownerId, generation, states = ['preparing']) {
  let updateInFlight = false;
  let leaseLost = false;
  const timer = setInterval(async () => {
    if (updateInFlight || leaseLost) return;
    updateInFlight = true;
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + SAGA_LEASE_MS);
    try {
      const renewed = await AdmissionSagaAttempt.updateOne({
        admission: admissionId,
        sagaId,
        ownerId,
        ownerGeneration: generation,
        state: { $in: states },
        leaseUntil: { $gt: now },
      }, { $set: { leaseUntil, updatedAt: now } });
      if (!renewed.matchedCount) {
        leaseLost = true;
        return;
      }
      const mirrored = await Admission.updateOne({
        ...admissionPointerFilter(admissionId, sagaId, ownerId, generation, states),
      }, { $set: { 'admissionSaga.leaseUntil': leaseUntil, 'admissionSaga.updatedAt': now } });
      if (!mirrored.matchedCount) leaseLost = true;
    } catch (error) {
      logger.error(`Admission saga lease renewal failed [${error.name || 'DatabaseError'}]`);
    } finally {
      updateInFlight = false;
    }
  }, Math.max(1000, Math.floor(SAGA_LEASE_MS / 3)));
  timer.unref();
  return {
    timer,
    assertOwned() {
      if (leaseLost) throw new Error('Admission saga lease ownership was lost');
    },
  };
}

function sagaTag(sagaId, generation, ownership = 'owned') {
  return {
    admissionSagaId: sagaId,
    admissionSagaGeneration: generation,
    admissionSagaOwnership: ownership,
  };
}

async function adoptSagaOwnedParent(Model, record, sagaId) {
  if (!record || !record.admissionSagaId || record.admissionSagaOwnership !== 'owned' || record.admissionSagaId === sagaId) {
    return record;
  }
  const updated = await Model.updateOne({
    _id: record._id,
    admissionSagaId: record.admissionSagaId,
    admissionSagaGeneration: record.admissionSagaGeneration,
    admissionSagaOwnership: 'owned',
  }, { $set: { admissionSagaOwnership: 'shared' } });
  if (!updated.matchedCount) {
    throw new ErrorResponse('The parent account changed during admission recovery; retry after review.', 409);
  }
  return Model.findById(record._id).select(OWNED_PARENT_FIELDS);
}

function hasCompleteJournal(attempt) {
  const r = attempt && attempt.resources;
  return Boolean(attempt && attempt.sagaId && r && r.studentUserId && r.studentId && r.studentFeeId &&
    r.parentUserCandidateId && r.parentProfileCandidateId);
}

async function cleanupSagaResources(attempt) {
  const { sagaId, resources } = attempt;
  const failures = [];
  const run = async (label, operation) => {
    try { await operation(); } catch (error) {
      failures.push(label);
      logger.error(`Admission saga cleanup failed (${label}) [${error.name || 'DatabaseError'}]`);
    }
  };

  if (!hasCompleteJournal(attempt)) return { failures: ['incomplete_journal'] };

  await run('outbox', () => EmailDelivery.updateMany({
    admissionSagaId: sagaId,
    status: { $in: ['staged', 'pending', 'processing', 'failed', 'dead_letter'] },
  }, {
    $set: { status: 'expired', purgeAt: new Date(Date.now() + 30 * 86400000) },
    $unset: { encryptedToken: 1, lockToken: 1, lockedAt: 1, leaseUntil: 1 },
  }));

  for (const token of attempt.activationTokens || []) {
    await run('activation token', () => User.updateOne({
      _id: token.userId,
      activationToken: token.tokenHash,
      activationTokenSagaId: sagaId,
      activationTokenSagaGeneration: token.generation,
    }, { $unset: {
      activationToken: 1,
      activationTokenExpire: 1,
      activationTokenSagaId: 1,
      activationTokenSagaGeneration: 1,
    } }));
  }

  if (resources.parentLink && resources.parentLink.parentId && resources.parentLink.studentId) {
    await run('parent child link', () => Parent.updateOne({
      _id: resources.parentLink.parentId,
      children: resources.parentLink.studentId,
    }, { $pull: {
      children: resources.parentLink.studentId,
      admissionSagaLinks: {
        sagaId,
        ownerGeneration: resources.parentLink.generation,
        studentId: resources.parentLink.studentId,
      },
    } }));
  }

  const otherParentLinks = resources.parentLink && await Parent.exists({
    _id: { $ne: resources.parentLink.parentId },
    children: resources.studentId,
  });
  const otherStudentOwners = await Student.exists({
    user: resources.studentUserId,
    _id: { $ne: resources.studentId },
  });
  if (!otherParentLinks && !otherStudentOwners) {
    await run('student fee', () => StudentFee.deleteOne({
      _id: resources.studentFeeId,
      admissionSagaId: sagaId,
      admissionSagaOwnership: 'owned',
    }));
    await run('student', () => Student.deleteOne({
      _id: resources.studentId,
      admissionSagaId: sagaId,
      admissionSagaOwnership: 'owned',
    }));
    await run('student user', () => User.deleteOne({
      _id: resources.studentUserId,
      admissionSagaId: sagaId,
      admissionSagaOwnership: 'owned',
    }));
  } else {
    failures.push('shared student resources preserved');
  }

  let parentIsShared = false;
  if (resources.parentUserId) {
    try {
      parentIsShared = Boolean(
        await Student.exists({ parentUser: resources.parentUserId }) ||
        await Parent.exists({
          user: resources.parentUserId,
          children: { $elemMatch: { $ne: resources.studentId } },
        }) ||
        await AdmissionSagaAttempt.exists({
          sagaId: { $ne: sagaId },
          'resources.parentUserId': resources.parentUserId,
          state: { $in: ['preparing', 'compensating', 'committed', 'manual_review'] },
        })
      );
    } catch (error) {
      parentIsShared = true;
      failures.push('parent ownership check');
      logger.error(`Admission parent ownership check failed [${error.name || 'DatabaseError'}]`);
    }
  }

  if (resources.parentProfileCreated && resources.parentProfileId && !parentIsShared) {
    await run('created parent profile', () => Parent.deleteOne({
      _id: resources.parentProfileId,
      user: resources.parentUserId,
      admissionSagaId: sagaId,
      admissionSagaOwnership: 'owned',
      children: { $not: { $elemMatch: { $ne: resources.studentId } } },
    }));
  }
  if (resources.parentUserCreated && resources.parentUserId && !parentIsShared) {
    const profileRemains = await Parent.exists({ user: resources.parentUserId });
    if (!profileRemains) {
      await run('created parent user', () => User.deleteOne({
        _id: resources.parentUserId,
        admissionSagaId: sagaId,
        admissionSagaOwnership: 'owned',
      }));
    }
  }

  return { failures };
}

async function setAttemptAndAdmissionReview(attempt, reason) {
  const attemptFilterForReview = {
    sagaId: attempt.sagaId,
    ownerGeneration: attempt.ownerGeneration,
    state: attempt.state,
  };
  if (attempt.ownerId) attemptFilterForReview.ownerId = attempt.ownerId;
  const changed = await AdmissionSagaAttempt.updateOne(attemptFilterForReview, {
    $set: {
      state: 'manual_review',
      step: 'manual_review',
      lastErrorCode: reason,
      updatedAt: new Date(),
      nextCleanupAt: new Date(Date.now() + ORPHAN_RECHECK_MS),
    },
    $unset: { ownerId: 1, leaseUntil: 1 },
  });
  if (!changed.matchedCount) return false;

  const admissionFilterForReview = {
    _id: attempt.admission,
    'admissionSaga.id': attempt.sagaId,
    'admissionSaga.ownerGeneration': attempt.ownerGeneration,
    'admissionSaga.state': attempt.state,
  };
  if (attempt.ownerId) {
    admissionFilterForReview.status = 'Admitting';
    admissionFilterForReview['admissionSaga.ownerId'] = attempt.ownerId;
  } else {
    admissionFilterForReview.status = { $in: ['Admitting', 'Approved'] };
  }
  await Admission.updateOne(admissionFilterForReview, {
    $set: {
      'admissionSaga.state': 'manual_review',
      'admissionSaga.step': 'manual_review',
      'admissionSaga.lastErrorCode': reason,
      'admissionSaga.updatedAt': new Date(),
    },
    $unset: { 'admissionSaga.ownerId': 1, 'admissionSaga.leaseUntil': 1 },
  });
  return true;
}

async function finalizeRolledBackAdmission(attempt) {
  await Admission.updateOne({
    _id: attempt.admission,
    status: 'Admitting',
    'admissionSaga.id': attempt.sagaId,
    'admissionSaga.ownerGeneration': attempt.ownerGeneration,
    'admissionSaga.state': 'compensating',
  }, {
    $set: {
      status: 'Approved',
      'admissionSaga.state': 'rolled_back',
      'admissionSaga.step': 'rolled_back',
      'admissionSaga.updatedAt': new Date(),
    },
    $unset: {
      createdStudent: 1,
      'admissionSaga.ownerId': 1,
      'admissionSaga.leaseUntil': 1,
      'admissionSaga.commitMarker': 1,
    },
  });
}

async function compensateAttempt(attempt) {
  const cleanup = await cleanupSagaResources(attempt);
  if (cleanup.failures.length) {
    await setAttemptAndAdmissionReview(attempt, 'COMPENSATION_REQUIRES_REVIEW');
    return { manualReview: true, failures: cleanup.failures };
  }
  const finished = await AdmissionSagaAttempt.updateOne({
    sagaId: attempt.sagaId,
    ownerId: attempt.ownerId,
    ownerGeneration: attempt.ownerGeneration,
    state: 'compensating',
  }, {
    $set: {
      state: 'rolled_back',
      step: 'rolled_back',
      updatedAt: new Date(),
      nextCleanupAt: new Date(Date.now() + ORPHAN_RECHECK_MS),
    },
    $unset: { ownerId: 1, leaseUntil: 1 },
  });
  if (!finished.matchedCount) return { manualReview: true, failures: ['ownership_changed'] };
  await finalizeRolledBackAdmission(attempt);
  return { rolledBack: true };
}

async function beginCompensation(attempt) {
  const changed = await AdmissionSagaAttempt.updateOne({
    sagaId: attempt.sagaId,
    ownerId: attempt.ownerId,
    ownerGeneration: attempt.ownerGeneration,
    state: 'preparing',
  }, {
    $set: {
      state: 'compensating',
      step: 'compensating',
      updatedAt: new Date(),
      leaseUntil: new Date(Date.now() + SAGA_LEASE_MS),
    },
  });
  if (!changed.matchedCount) return null;
  await Admission.updateOne({
    ...admissionPointerFilter(attempt.admission, attempt.sagaId, attempt.ownerId, attempt.ownerGeneration),
  }, {
    $set: {
      'admissionSaga.state': 'compensating',
      'admissionSaga.step': 'compensating',
      'admissionSaga.leaseUntil': new Date(Date.now() + SAGA_LEASE_MS),
      'admissionSaga.updatedAt': new Date(),
    },
  });
  return AdmissionSagaAttempt.findOne({ sagaId: attempt.sagaId }).lean();
}

function commitMarker(sagaId, generation) {
  return `${sagaId}:${generation}`;
}

async function finalizeCommittedAttempt(attempt) {
  if (!attempt || attempt.state !== 'committed' ||
      attempt.commitMarker !== commitMarker(attempt.sagaId, attempt.ownerGeneration)) return false;
  const marker = attempt.commitMarker;
  const updated = await Admission.updateOne({
    _id: attempt.admission,
    status: 'Admitting',
    'admissionSaga.id': attempt.sagaId,
    'admissionSaga.ownerGeneration': attempt.ownerGeneration,
    'admissionSaga.state': { $in: ['preparing', 'committed'] },
  }, {
    $set: {
      status: 'Admitted',
      createdStudent: attempt.committedStudentId || attempt.resources.studentId,
      'admissionSaga.state': 'committed',
      'admissionSaga.step': 'committed',
      'admissionSaga.commitMarker': marker,
      'admissionSaga.committedAt': attempt.committedAt || new Date(),
      'admissionSaga.updatedAt': new Date(),
    },
    $unset: { 'admissionSaga.ownerId': 1, 'admissionSaga.leaseUntil': 1 },
  });
  if (!updated.matchedCount) {
    const current = await Admission.findOne({
      _id: attempt.admission,
      status: 'Admitted',
      'admissionSaga.id': attempt.sagaId,
      'admissionSaga.ownerGeneration': attempt.ownerGeneration,
      'admissionSaga.commitMarker': marker,
    }).select('_id');
    if (!current) return false;
  }
  await AdmissionSagaAttempt.updateOne({
    sagaId: attempt.sagaId,
    ownerGeneration: attempt.ownerGeneration,
    state: 'committed',
    commitMarker: marker,
  }, { $set: { admissionFinalizedAt: new Date(), nextCleanupAt: null } });
  return true;
}

async function releaseSagaDeliveries(sagaId) {
  const staged = await EmailDelivery.find({ admissionSagaId: sagaId, status: 'staged' }).select('_id');
  await releaseStagedDeliveries(staged.map(({ _id }) => _id));
}

async function admitStudent(admissionId) {
  const admission = await Admission.findById(admissionId);
  if (!admission) throw new ErrorResponse('Admission not found.', 404);
  if (admission.status !== 'Approved') throw new ErrorResponse('Admission must be approved before student creation.', 409);
  if (!admission.enrollmentEffectiveFrom || !admission.enrollmentAcademicYear) {
    throw new ErrorResponse('Admission requires an explicitly approved enrollment date and academic year before student creation.', 409);
  }
  const enrollment = await resolveEffectiveDate(
    schoolDateKey(admission.enrollmentEffectiveFrom), admission.enrollmentAcademicYear, { activeOnly: false }
  );
  await ensureSagaIndexes();
  const sagaId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const ownerGeneration = 1;
  const now = new Date();
  const resources = {
    studentUserId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    studentFeeId: new mongoose.Types.ObjectId(),
    parentUserCandidateId: new mongoose.Types.ObjectId(),
    parentProfileCandidateId: new mongoose.Types.ObjectId(),
    parentUserCreated: false,
    parentProfileCreated: false,
  };

  const reviewRequired = await AdmissionSagaAttempt.exists({ admission: admissionId, state: 'manual_review' });
  if (reviewRequired || admission.admissionSaga && admission.admissionSaga.state === 'manual_review') {
    throw new ErrorResponse('Admission saga requires manual review before it can be retried.', 409);
  }
  const priorCommit = await AdmissionSagaAttempt.findOne({ admission: admissionId, state: 'committed' }).lean();
  if (priorCommit) {
    await finalizeCommittedAttempt(priorCommit);
    throw new ErrorResponse('Admission already has a durable saga commit.', 409);
  }

  // Claim admission first. If the process dies before the separate journal is
  // durable, recovery quarantines the expired admission; a resumed owner then
  // fails the admission-pointer check before it can create business records.
  const claimedAdmission = await Admission.findOneAndUpdate({
    _id: admissionId,
    status: 'Approved',
    enrollmentEffectiveFrom: admission.enrollmentEffectiveFrom,
    enrollmentAcademicYear: admission.enrollmentAcademicYear,
    'admissionSaga.state': { $ne: 'manual_review' },
  }, {
    $set: {
      status: 'Admitting',
      admissionSaga: {
        id: sagaId,
        state: 'preparing',
        ownerId,
        ownerGeneration,
        leaseUntil: new Date(now.getTime() + SAGA_LEASE_MS),
        startedAt: now,
        updatedAt: now,
        step: 'claimed',
        attempts: 0,
        resources,
        activationTokens: [],
      },
    },
  }, { new: true });
  if (!claimedAdmission) {
    throw new ErrorResponse('Admission changed concurrently; reload and retry.', 409);
  }

  await runSagaTestHook('after:admission_claim', { admissionId, sagaId, ownerId, ownerGeneration });
  const attempt = await AdmissionSagaAttempt.create({
    sagaId,
    admission: admissionId,
    enrollmentEffectiveFrom: enrollment.effectiveFrom,
    enrollmentAcademicYear: enrollment.academicYear,
    ownerId,
    ownerGeneration,
    state: 'preparing',
    leaseUntil: new Date(now.getTime() + SAGA_LEASE_MS),
    startedAt: now,
    updatedAt: now,
    step: 'planned',
    attempts: 0,
    resources,
    activationTokens: [],
  });

  let heartbeat = startSagaHeartbeat(admissionId, sagaId, ownerId, ownerGeneration);
  let student;
  let parentUser;
  let parentProfile;
  let committed = false;
  const checkpoint = (step, fields, addToSet) => checkpointSaga(
    admissionId, sagaId, ownerId, ownerGeneration, step, fields, addToSet
  );

  try {
    await runSagaTestHook('after:claimed', { admissionId, sagaId, ownerId, ownerGeneration });
    const academicYear = claimedAdmission.enrollmentAcademicYear;
    const counterId = `rollNumber_${academicYear}_${claimedAdmission.classApplyingFor}`;
    await assertSagaOwnership(admissionId, sagaId, ownerId, ownerGeneration, 'counter');
    const counter = await Counter.findByIdAndUpdate(counterId, { $inc: { seq: 1 } }, { new: true, upsert: true });
    await checkpoint('counter_allocated');

    await assertSagaOwnership(admissionId, sagaId, ownerId, ownerGeneration, 'student_user');
    const studentEmail = claimedAdmission.studentEmail || `student_${crypto.randomUUID()}@RBG.edu.in`;
    const studentUser = await User.create({
      _id: resources.studentUserId,
      name: claimedAdmission.studentName,
      email: studentEmail,
      password: crypto.randomBytes(32).toString('hex'),
      role: 'student',
      isActive: false,
      isEmailVerified: false,
      ...sagaTag(sagaId, ownerGeneration),
    });
    await runSagaTestHook('after:student_user_write', { admissionId, sagaId, ownerGeneration });
    await checkpoint('student_user_created');

    const parentName = claimedAdmission.fatherName || claimedAdmission.motherName || claimedAdmission.guardianName || 'Parent';
    const parentEmail = claimedAdmission.fatherEmail || claimedAdmission.motherEmail || `parent_${studentUser._id}@RBG.edu.in`;
    parentUser = await User.findOne({ email: parentEmail }).select(OWNED_PARENT_FIELDS);
    if (parentUser) {
      if (parentUser.role !== 'parent') throw new ErrorResponse('The admission contact email is already used by a non-parent account.', 409);
      if (Boolean(parentUser.isActive) !== Boolean(parentUser.isEmailVerified)) {
        throw new ErrorResponse('The existing parent account has an inconsistent activation state.', 409);
      }
      resources.parentUserId = parentUser._id;
      resources.parentUserCreated = false;
      await checkpoint('parent_user_reused', {
        'admissionSaga.resources.parentUserId': parentUser._id,
        'admissionSaga.resources.parentUserCreated': false,
      });
      parentUser = await adoptSagaOwnedParent(User, parentUser, sagaId);
      const inProgress = await AdmissionSagaAttempt.exists({
        sagaId: { $ne: sagaId },
        state: { $in: ['preparing', 'compensating', 'manual_review'] },
        'resources.parentUserId': parentUser._id,
      });
      if (inProgress) throw new ErrorResponse('This parent account is being processed by another admission; retry later.', 409);
    } else {
      resources.parentUserId = resources.parentUserCandidateId;
      resources.parentUserCreated = true;
      await checkpoint('parent_user_creation_planned', {
        'admissionSaga.resources.parentUserId': resources.parentUserId,
        'admissionSaga.resources.parentUserCreated': true,
      });
      await assertSagaOwnership(admissionId, sagaId, ownerId, ownerGeneration, 'parent_user');
      parentUser = await User.create({
        _id: resources.parentUserCandidateId,
        name: parentName,
        email: parentEmail,
        password: crypto.randomBytes(32).toString('hex'),
        role: 'parent',
        isActive: false,
        isEmailVerified: false,
        ...sagaTag(sagaId, ownerGeneration),
      });
      await runSagaTestHook('after:parent_user_write', { admissionId, sagaId, ownerGeneration });
      await checkpoint('parent_user_created');
    }

    parentProfile = await Parent.findOne({ user: parentUser._id }).select(OWNED_PARENT_FIELDS);
    if (parentProfile) {
      resources.parentProfileId = parentProfile._id;
      resources.parentProfileCreated = false;
      await checkpoint('parent_profile_reused', {
        'admissionSaga.resources.parentProfileId': parentProfile._id,
        'admissionSaga.resources.parentProfileCreated': false,
      });
      parentProfile = await adoptSagaOwnedParent(Parent, parentProfile, sagaId);
    } else {
      resources.parentProfileId = resources.parentProfileCandidateId;
      resources.parentProfileCreated = true;
      await checkpoint('parent_profile_creation_planned', {
        'admissionSaga.resources.parentProfileId': resources.parentProfileId,
        'admissionSaga.resources.parentProfileCreated': true,
      });
      await assertSagaOwnership(admissionId, sagaId, ownerId, ownerGeneration, 'parent_profile');
      parentProfile = await Parent.create({
        _id: resources.parentProfileCandidateId,
        user: parentUser._id,
        children: [],
        emergencyPhone: claimedAdmission.fatherPhone || claimedAdmission.motherPhone || claimedAdmission.guardianPhone || '0000000000',
        relationship: claimedAdmission.fatherName ? 'Father' : (claimedAdmission.motherName ? 'Mother' : 'Guardian'),
        ...sagaTag(sagaId, ownerGeneration),
      });
      await runSagaTestHook('after:parent_profile_write', { admissionId, sagaId, ownerGeneration });
      await checkpoint('parent_profile_created');
    }

    await assertSagaOwnership(admissionId, sagaId, ownerId, ownerGeneration, 'student');
    if (claimedAdmission.section || claimedAdmission.sections) {
      throw new ErrorResponse('Class sections are not supported. RBG School ERP models single undivided classes per level.', 400);
    }
    let canonicalStudentClass;
    try {
      canonicalStudentClass = Class.validateAndNormalizeClassWrite(claimedAdmission.classApplyingFor, 'classApplyingFor');
    } catch (err) {
      throw new ErrorResponse(err.message, 400);
    }
    student = await Student.create({
      _id: resources.studentId,
      user: studentUser._id,
      parentUser: parentUser._id,
      class: canonicalStudentClass,
      stream: claimedAdmission.stream || 'N/A',
      rollNumber: counter.seq,
      academicYear,
      enrollmentEffectiveFrom: enrollment.effectiveFrom,
      father: { name: claimedAdmission.fatherName || 'Not Provided', phone: claimedAdmission.fatherPhone, email: claimedAdmission.fatherEmail },
      mother: { name: claimedAdmission.motherName || 'Not Provided', phone: claimedAdmission.motherPhone, email: claimedAdmission.motherEmail },
      ...sagaTag(sagaId, ownerGeneration, 'owned'),
    });
    await runSagaTestHook('after:student_write', { admissionId, sagaId, ownerGeneration });
    await checkpoint('student_created');

    resources.parentLink = {
      parentId: parentProfile._id,
      studentId: student._id,
      generation: ownerGeneration,
      state: 'planned',
    };
    await checkpoint('parent_link_planned', { 'admissionSaga.parentLink': resources.parentLink });
    await assertSagaOwnership(admissionId, sagaId, ownerId, ownerGeneration, 'parent_link');
    const parentLinkKey = {
      sagaId,
      ownerGeneration,
      studentId: student._id,
    };
    const linked = await Parent.updateOne({
      _id: parentProfile._id,
      $or: [
        { children: { $ne: student._id } },
        { admissionSagaLinks: { $elemMatch: parentLinkKey } },
      ],
    }, { $addToSet: {
      children: student._id,
      admissionSagaLinks: parentLinkKey,
    } });
    if (!linked.matchedCount) throw new Error('Parent profile disappeared while linking the admitted student');
    await runSagaTestHook('after:parent_link_write', { admissionId, sagaId, ownerGeneration });
    resources.parentLink.state = 'applied';
    await checkpoint('parent_linked', { 'admissionSaga.parentLink': resources.parentLink });

    const feeStructure = await FeeStructure.findOne({
      class: student.class,
      academicYear: student.academicYear,
      isActive: true,
    });
    if (feeStructure) {
      const totalAmount = feeStructure.components
        ? feeStructure.components.reduce((total, component) => total + (component.amount || 0), 0)
        : 0;
      await assertSagaOwnership(admissionId, sagaId, ownerId, ownerGeneration, 'student_fee');
      await StudentFee.create({
        _id: resources.studentFeeId,
        student: student._id,
        feeStructure: feeStructure._id,
        class: student.class,
        academicYear: student.academicYear,
        totalAmount,
        status: 'Pending',
        ...sagaTag(sagaId, ownerGeneration, 'owned'),
      });
      await runSagaTestHook('after:student_fee_write', { admissionId, sagaId, ownerGeneration });
      await checkpoint('student_fee_created');
    } else {
      await checkpoint('student_fee_skipped');
    }

    const stageActivation = async (account, step) => {
      await authService.sendActivationEmail(account, {
        deferEnqueue: true,
        relatedAdmission: admissionId,
        admissionSagaId: sagaId,
        admissionSagaGeneration: ownerGeneration,
        beforeTokenPersist: async ({ userId, tokenHash }) => checkpoint(
          `${step}_token_journaled`,
          {},
          { 'admissionSaga.activationTokens': { userId, tokenHash, generation: ownerGeneration } }
        ),
        assertBeforeTokenPersist: async () => assertSagaOwnership(
          admissionId, sagaId, ownerId, ownerGeneration, `${step}_activation_token`
        ),
        afterTokenPersist: async () => runSagaTestHook(`after:${step}_activation_token_persist`, {
          admissionId, sagaId, ownerGeneration,
        }),
        beforeDeliveryCreate: async () => assertSagaOwnership(
          admissionId, sagaId, ownerId, ownerGeneration, 'email_delivery'
        ),
      });
      await runSagaTestHook(`after:${step}_delivery_write`, { admissionId, sagaId, ownerGeneration });
      await checkpoint(`${step}_delivery_staged`);
    };
    await stageActivation(studentUser, 'student');
    if (!parentUser.isActive) await stageActivation(parentUser, 'parent');

    await assertSagaOwnership(admissionId, sagaId, ownerId, ownerGeneration, 'commit');
    const marker = commitMarker(sagaId, ownerGeneration);
    const committedResult = await AdmissionSagaAttempt.updateOne({
      ...attemptFilter(admissionId, sagaId, ownerId, ownerGeneration),
      state: 'preparing',
    }, {
      $set: {
        state: 'committed',
        step: 'committed',
        commitMarker: marker,
        committedStudentId: student._id,
        committedAt: new Date(),
        updatedAt: new Date(),
      },
      $unset: { ownerId: 1, leaseUntil: 1 },
    });
    if (!committedResult.matchedCount) throw new Error('Admission saga generation lost its commit fence');
    committed = true;
    await runSagaTestHook('after:commit_boundary', { admissionId, sagaId, ownerGeneration, marker });
    const committedAttempt = await AdmissionSagaAttempt.findOne({ sagaId }).lean();
    if (!(await finalizeCommittedAttempt(committedAttempt))) {
      throw new Error('Committed saga requires admission finalization recovery');
    }
    await releaseSagaDeliveries(sagaId);
    heartbeat.timer && clearInterval(heartbeat.timer);
    return Student.findById(student._id);
  } catch (error) {
    if (error && error.simulateSagaCrash === true && process.env.NODE_ENV === 'test') throw error;
    clearInterval(heartbeat.timer);
    const currentAttempt = await AdmissionSagaAttempt.findOne({ sagaId }).lean().catch(() => null);
    if (currentAttempt && currentAttempt.state === 'committed') {
      committed = true;
      const finalized = await finalizeCommittedAttempt(currentAttempt).catch(() => false);
      if (finalized) {
        await releaseSagaDeliveries(sagaId).catch((releaseError) => {
          logger.error(`Committed admission email release deferred to reconciliation [${releaseError.name || 'DatabaseError'}]`);
        });
        return Student.findById(currentAttempt.committedStudentId || resources.studentId);
      }
      throw error;
    }

    try {
      let cleanupAttempt = currentAttempt;
      if (currentAttempt && currentAttempt.state === 'preparing' &&
          currentAttempt.ownerId === ownerId && currentAttempt.ownerGeneration === ownerGeneration) {
        cleanupAttempt = await beginCompensation(currentAttempt);
      }
      if (cleanupAttempt && cleanupAttempt.state === 'compensating' && cleanupAttempt.ownerId === ownerId) {
        const cleanupHeartbeat = startSagaHeartbeat(admissionId, sagaId, ownerId, ownerGeneration, ['compensating']);
        try { await compensateAttempt(cleanupAttempt); } finally { clearInterval(cleanupHeartbeat.timer); }
      } else if (cleanupAttempt && cleanupAttempt.state !== 'committed') {
        const result = await cleanupSagaResources(cleanupAttempt);
        if (result.failures.length) await setAttemptAndAdmissionReview(cleanupAttempt, 'LATE_WRITE_CLEANUP_REQUIRES_REVIEW');
      }
    } catch (cleanupError) {
      logger.error(`Admission saga cleanup deferred to recovery [${cleanupError.name || 'DatabaseError'}]`);
    }
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat.timer);
  }
}

async function finalizeCommittedAttempts() {
  const pending = await AdmissionSagaAttempt.find({
    state: 'committed',
    admissionFinalizedAt: { $exists: false },
  }).sort({ committedAt: 1, _id: 1 }).limit(RECOVERY_BATCH_SIZE).lean();
  for (const attempt of pending) {
    await finalizeCommittedAttempt(attempt).catch((error) => {
      logger.error(`Committed admission finalization deferred [${error.name || 'DatabaseError'}]`);
    });
  }
}

async function finalizeCompensatingAttempt(attempt) {
  const current = await AdmissionSagaAttempt.findOneAndUpdate({
    sagaId: attempt.sagaId,
    ownerGeneration: attempt.ownerGeneration,
    state: { $in: ['preparing', 'compensating'] },
    leaseUntil: { $lte: new Date() },
  }, {
    $set: {
      state: 'compensating',
      ownerId: crypto.randomUUID(),
      ownerGeneration: attempt.ownerGeneration + 1,
      leaseUntil: new Date(Date.now() + SAGA_LEASE_MS),
      updatedAt: new Date(),
      step: 'recovery_compensating',
      nextCleanupAt: null,
    },
    $inc: { attempts: 1 },
  }, { new: true }).lean();
  if (!current) return;

  await Admission.updateOne({
    _id: current.admission,
    status: 'Admitting',
    'admissionSaga.id': current.sagaId,
  }, {
    $set: {
      'admissionSaga.state': 'compensating',
      'admissionSaga.ownerId': current.ownerId,
      'admissionSaga.ownerGeneration': current.ownerGeneration,
      'admissionSaga.leaseUntil': current.leaseUntil,
      'admissionSaga.step': current.step,
      'admissionSaga.updatedAt': current.updatedAt,
    },
  });

  const heartbeat = startSagaHeartbeat(
    current.admission, current.sagaId, current.ownerId, current.ownerGeneration, ['compensating']
  );
  try {
    await compensateAttempt(current);
  } catch (error) {
    await setAttemptAndAdmissionReview(current, 'RECOVERY_REQUIRES_REVIEW').catch(() => {});
    logger.error(`Admission saga recovery failed [${error.name || 'DatabaseError'}]`);
  } finally {
    clearInterval(heartbeat.timer);
  }
}

async function sweepNonCommittedAttempts() {
  const now = new Date();
  const due = await AdmissionSagaAttempt.find({
    state: { $in: ['rolled_back', 'manual_review'] },
    $or: [
      { nextCleanupAt: { $lte: now } },
      { nextCleanupAt: { $exists: false } },
    ],
  }).sort({ nextCleanupAt: 1, _id: 1 }).limit(RECOVERY_BATCH_SIZE).lean();
  for (const attempt of due) {
    const result = await cleanupSagaResources(attempt);
    if (result.failures.length && attempt.state !== 'manual_review') {
      await setAttemptAndAdmissionReview(attempt, 'ORPHAN_CLEANUP_REQUIRES_REVIEW');
    } else {
      await AdmissionSagaAttempt.updateOne({ sagaId: attempt.sagaId, state: attempt.state }, {
        $set: { nextCleanupAt: new Date(Date.now() + ORPHAN_RECHECK_MS), updatedAt: new Date() },
      });
      if (attempt.state === 'rolled_back') await finalizeRolledBackAdmission(attempt);
    }
  }
}

async function markLegacyAdmissionsForReview() {
  const now = new Date();
  const rows = await Admission.find({
    status: 'Admitting',
    'admissionSaga.id': { $exists: true },
    'admissionSaga.leaseUntil': { $lte: now },
  }).select('_id admissionSaga.id').limit(RECOVERY_BATCH_SIZE).lean();
  for (const row of rows) {
    const attempt = await AdmissionSagaAttempt.exists({ sagaId: row.admissionSaga.id, admission: row._id });
    if (!attempt) {
      await Admission.updateOne({ _id: row._id, status: 'Admitting', 'admissionSaga.id': row.admissionSaga.id }, {
        $set: {
          'admissionSaga.state': 'manual_review',
          'admissionSaga.step': 'missing_attempt_journal',
          'admissionSaga.lastErrorCode': 'MISSING_DURABLE_SAGA_ATTEMPT',
        },
        $unset: { 'admissionSaga.ownerId': 1, 'admissionSaga.leaseUntil': 1 },
      });
    }
  }
  await Admission.updateMany({
    status: 'Admitting',
    'admissionSaga.id': { $exists: false },
    updatedAt: { $lte: new Date(now.getTime() - SAGA_LEASE_MS) },
  }, {
    $set: {
      'admissionSaga.state': 'manual_review',
      'admissionSaga.step': 'legacy_unjournaled',
      'admissionSaga.lastErrorCode': 'INCOMPLETE_SAGA_JOURNAL',
    },
  });
}

async function recoverStaleAdmissionSagasOnce() {
  await ensureSagaIndexes();
  const now = new Date();
  const stale = await AdmissionSagaAttempt.find({
    state: { $in: ['preparing', 'compensating'] },
    leaseUntil: { $lte: now },
  }).sort({ leaseUntil: 1, _id: 1 }).limit(RECOVERY_BATCH_SIZE).lean();
  for (const attempt of stale) await finalizeCompensatingAttempt(attempt);
  await finalizeCommittedAttempts();
  await sweepNonCommittedAttempts();
  await markLegacyAdmissionsForReview();
}

function recoverStaleAdmissionSagas() {
  if (recoveryPromise) return recoveryPromise;
  recoveryPromise = recoverStaleAdmissionSagasOnce().finally(() => { recoveryPromise = null; });
  return recoveryPromise;
}

function setSagaTestHook(hook) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Saga test hooks are available only in NODE_ENV=test.');
  sagaTestHook = typeof hook === 'function' ? hook : null;
}

module.exports = {
  admitStudent,
  recoverStaleAdmissionSagas,
  setSagaTestHook,
};
