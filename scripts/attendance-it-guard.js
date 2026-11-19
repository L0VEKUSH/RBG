'use strict';

const crypto = require('node:crypto');

const HOST = '127.0.0.1';
const PORT = 27018;
const REPLICA_SET = 'rbgAttendanceIT';
const MEMBER_ADDRESS = `${HOST}:${PORT}`;
const DATABASE_PREFIX = 'erp_attendance_it_';
const HARNESS_ID = 'rbg-attendance-it-v1';
const OWNER_MARKER_ID = 'attendance-it-owner';
const OWNER_COLLECTION = 'attendance_it_ownership';
const TOPOLOGY_PROOF_MAX_AGE_MS = 5000;
const RUN_ID_PATTERN = /^[a-f0-9]{32}$/;
const NONCE_PATTERN = /^[a-f0-9]{64}$/;

const runContexts = new WeakSet();
const runContextStates = new WeakMap();
const validatedTargets = new WeakSet();
const targetContexts = new WeakMap();
const topologyStates = new WeakMap();
const ownershipLeases = new WeakSet();
const ownershipLeaseStates = new WeakMap();
const topologyValidations = new WeakSet();

function requireTestEnvironment() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Attendance integration guard requires process.env.NODE_ENV=test.');
  }
}

function generateRunId() {
  return crypto.randomBytes(16).toString('hex');
}

function validateRunId(runId) {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
    throw new Error('Invalid attendance test run ID.');
  }
  return runId;
}

function databaseNameForRunId(runId) {
  return `${DATABASE_PREFIX}${validateRunId(runId)}`;
}

function createRunContext(...args) {
  requireTestEnvironment();
  if (args.length !== 0) {
    throw new Error('Attendance test run context does not accept a caller-supplied run ID.');
  }

  const runId = generateRunId();
  const context = Object.freeze({
    runId,
    databaseName: databaseNameForRunId(runId),
  });
  runContexts.add(context);
  runContextStates.set(context, {
    uriIssued: false,
    target: null,
    lease: null,
    retired: false,
  });
  return context;
}

function requireRunContext(context) {
  if (!runContexts.has(context)) {
    throw new Error('Invalid attendance test run context.');
  }
  return runContextStates.get(context);
}

function buildTestUri(context) {
  requireTestEnvironment();
  const state = requireRunContext(context);
  if (state.retired || state.uriIssued) {
    throw new Error('Attendance test run context has already issued its target URI.');
  }
  state.uriIssued = true;
  return `mongodb://${HOST}:${PORT}/${context.databaseName}?replicaSet=${REPLICA_SET}`;
}

function validateTestUri(uri, context) {
  requireTestEnvironment();
  const state = requireRunContext(context);
  if (state.retired || !state.uriIssued || state.target) {
    throw new Error('Attendance test target must be validated once after URI construction.');
  }

  const databaseName = context.databaseName;
  const expectedUri = `mongodb://${HOST}:${PORT}/${databaseName}?replicaSet=${REPLICA_SET}`;
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new Error('Invalid attendance test MongoDB target.');
  }

  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error('Invalid attendance test MongoDB target.');
  }

  const query = [...parsed.searchParams.entries()];
  const valid = uri === expectedUri &&
    parsed.protocol === 'mongodb:' &&
    parsed.hostname === HOST &&
    parsed.port === String(PORT) &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname === `/${databaseName}` &&
    parsed.hash === '' &&
    query.length === 1 &&
    query[0][0] === 'replicaSet' &&
    query[0][1] === REPLICA_SET;

  if (!valid) {
    throw new Error('Attendance test MongoDB target does not match the required local replica set.');
  }

  const target = Object.freeze({
    scheme: 'mongodb',
    host: HOST,
    port: PORT,
    replicaSet: REPLICA_SET,
    databaseName,
    runId: context.runId,
  });
  validatedTargets.add(target);
  targetContexts.set(target, context);
  state.target = target;
  return target;
}

function isOwnershipMarkerShape(marker, runId) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return false;
  try {
    validateRunId(runId);
  } catch {
    return false;
  }

  const expectedKeys = ['_id', 'harnessId', 'ownershipNonce', 'runId'];
  const keys = Object.keys(marker).sort();
  return keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    marker._id === OWNER_MARKER_ID &&
    marker.harnessId === HARNESS_ID &&
    marker.runId === runId &&
    typeof marker.ownershipNonce === 'string' &&
    NONCE_PATTERN.test(marker.ownershipNonce);
}

function nonceMatches(expectedNonce, actualNonce) {
  if (typeof actualNonce !== 'string' || !NONCE_PATTERN.test(actualNonce)) return false;
  const actual = Buffer.from(actualNonce, 'hex');
  return actual.length === expectedNonce.length && crypto.timingSafeEqual(expectedNonce, actual);
}

function createOwnershipLease(context) {
  requireTestEnvironment();
  const contextState = requireRunContext(context);
  if (contextState.retired) {
    throw new Error('Attendance test run context is retired.');
  }
  if (contextState.lease) {
    throw new Error('Attendance test run context already has an ownership lease.');
  }

  const runId = context.runId;
  const databaseName = context.databaseName;
  const nonce = crypto.randomBytes(32);
  const expectedMarker = Object.freeze({
    _id: OWNER_MARKER_ID,
    harnessId: HARNESS_ID,
    runId,
    ownershipNonce: nonce.toString('hex'),
  });

  const leaseState = { context, retired: false };
  const matchesLeaseMarkerValues = marker =>
    !leaseState.retired &&
    isOwnershipMarkerShape(marker, runId) &&
    marker._id === expectedMarker._id &&
    marker.harnessId === expectedMarker.harnessId &&
    nonceMatches(nonce, marker.ownershipNonce);

  const lease = Object.freeze({
    runId,
    databaseName,
    markerForInsert() {
      if (leaseState.retired || contextState.retired) {
        throw new Error('Attendance ownership lease is retired.');
      }
      return Object.freeze({ ...expectedMarker });
    },
    matchesLeaseMarkerValues,
    retireRunAfterTopologyValidation(topologyValidation) {
      requireTestEnvironment();
      const currentContextState = runContextStates.get(context);
      const currentLeaseState = ownershipLeaseStates.get(lease);
      const topologyState = topologyStates.get(topologyValidation);
      const topologyAgeNs = topologyState
        ? process.hrtime.bigint() - topologyState.validatedAtNs
        : -1n;
      const topologyIsFresh = topologyAgeNs >= 0n &&
        topologyAgeNs <= BigInt(TOPOLOGY_PROOF_MAX_AGE_MS) * 1_000_000n;

      const valid = ownershipLeases.has(lease) &&
        currentLeaseState &&
        !currentLeaseState.retired &&
        currentContextState &&
        !currentContextState.retired &&
        currentContextState.lease === lease &&
        topologyValidations.has(topologyValidation) &&
        topologyState &&
        validatedTargets.has(topologyState.target) &&
        topologyState.target === currentContextState.target &&
        topologyState.target.databaseName === databaseName &&
        topologyState.target.runId === runId &&
        !topologyState.consumed &&
        topologyIsFresh;

      if (!valid) return false;

      currentContextState.retired = true;
      currentLeaseState.retired = true;
      topologyState.consumed = true;
      return true;
    },
  });

  ownershipLeases.add(lease);
  ownershipLeaseStates.set(lease, leaseState);
  contextState.lease = lease;
  return lease;
}

function optionalBooleanFalse(hello, field) {
  return !Object.prototype.hasOwnProperty.call(hello, field) || hello[field] === false;
}

function validateHelloResponseShape(hello, target) {
  requireTestEnvironment();
  const context = targetContexts.get(target);
  const contextState = runContextStates.get(context);
  const valid = hello && typeof hello === 'object' && !Array.isArray(hello) &&
    validatedTargets.has(target) &&
    contextState &&
    !contextState.retired &&
    hello.msg === undefined &&
    hello.setName === REPLICA_SET &&
    hello.isWritablePrimary === true &&
    hello.secondary === false &&
    optionalBooleanFalse(hello, 'arbiterOnly') &&
    optionalBooleanFalse(hello, 'hidden') &&
    optionalBooleanFalse(hello, 'isreplicaset') &&
    hello.me === MEMBER_ADDRESS &&
    hello.primary === MEMBER_ADDRESS &&
    Array.isArray(hello.hosts) &&
    hello.hosts.length === 1 &&
    hello.hosts[0] === MEMBER_ADDRESS &&
    Array.isArray(hello.passives) &&
    hello.passives.length === 0 &&
    Array.isArray(hello.arbiters) &&
    hello.arbiters.length === 0;

  if (!valid) {
    throw new Error('MongoDB hello response is not the required single-member attendance test replica set.');
  }

  const validation = Object.freeze({
    replicaSet: REPLICA_SET,
    member: MEMBER_ADDRESS,
    primary: MEMBER_ADDRESS,
    writablePrimary: true,
  });
  topologyValidations.add(validation);
  topologyStates.set(validation, {
    target,
    validatedAtNs: process.hrtime.bigint(),
    consumed: false,
  });
  return validation;
}

module.exports = {
  HOST,
  PORT,
  REPLICA_SET,
  MEMBER_ADDRESS,
  DATABASE_PREFIX,
  HARNESS_ID,
  OWNER_MARKER_ID,
  OWNER_COLLECTION,
  TOPOLOGY_PROOF_MAX_AGE_MS,
  generateRunId,
  validateRunId,
  databaseNameForRunId,
  requireTestEnvironment,
  createRunContext,
  buildTestUri,
  validateTestUri,
  validateHelloResponseShape,
  isOwnershipMarkerShape,
  createOwnershipLease,
};
