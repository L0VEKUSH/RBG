'use strict';

const mongoose = require('mongoose');
const guard = require('./attendance-it-guard');

const ATTENDANCE_COLLECTION = 'attendances';
const SCHOOL_UTC_OFFSET_MINUTES = 330;
const CONNECT_TIMEOUT_MS = 5000;
const TRANSACTION_OPTIONS = Object.freeze({
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
  maxCommitTimeMS: 10000,
});
const TRANSACTION_STATE = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMMITTED: 'COMMITTED',
  ABORTED: 'ABORTED',
  UNKNOWN: 'UNKNOWN',
});
const PHASE = Object.freeze({
  UNINITIALIZED: 'UNINITIALIZED',
  TARGET_GENERATED: 'TARGET_GENERATED',
  CONNECTED: 'CONNECTED',
  OWNERSHIP_CLAIMED: 'OWNERSHIP_CLAIMED',
  SCENARIOS_RUNNING: 'SCENARIOS_RUNNING',
  SCENARIOS_QUIESCENT: 'SCENARIOS_QUIESCENT',
  RECONCILIATION_COMPLETE: 'RECONCILIATION_COMPLETE',
  CLEANUP_PREFLIGHT_COMPLETE: 'CLEANUP_PREFLIGHT_COMPLETE',
  CLEANUP_ATTEMPTED: 'CLEANUP_ATTEMPTED',
  CLEANED: 'CLEANED',
  RETAINED_TERMINAL_FAILURE: 'RETAINED_TERMINAL_FAILURE',
  RETAINED: 'RETAINED',
});

const LOGICAL_KEY = Object.freeze([
  ['student', 1],
  ['class', 1],
  ['date', 1],
  ['subject', 1],
  ['academicYear', 1],
]);
const CLASS_DATE_KEY = Object.freeze([['class', 1], ['date', 1]]);
const ID_KEY = Object.freeze([['_id', 1]]);
const RECORD_FIELDS = Object.freeze([
  '_id', 'student', 'class', 'date', 'status', 'subject', 'markedBy',
  'remarks', 'academicYear', 'createdAt', 'updatedAt', '__v',
]);

class RunnerFailure extends Error {
  constructor(code) {
    super(code);
    this.name = 'RunnerFailure';
    this.code = code;
  }
}

class ExpectedAbort extends Error {
  constructor(code) {
    super(code);
    this.name = 'ExpectedAbort';
    this.code = code;
  }
}

class StaleAttendanceConflict extends ExpectedAbort {
  constructor() {
    super('STALE_ATTENDANCE_CONFLICT');
    this.name = 'StaleAttendanceConflict';
  }
}

function fail(code) {
  throw new RunnerFailure(code);
}

function parseInvocation(argv) {
  if (!Array.isArray(argv) || argv.some(argument => typeof argument !== 'string')) {
    fail('INVALID_ARGUMENTS');
  }
  if (argv.length === 0) return Object.freeze({ cleanupRequested: false });
  if (argv.length === 1 && argv[0] === '--cleanup') {
    return Object.freeze({ cleanupRequested: true });
  }
  fail('INVALID_ARGUMENTS');
}

function requireTestEnvironment() {
  if (process.env.NODE_ENV !== 'test') fail('NODE_ENV_MUST_BE_TEST');
}

function createRunState(invocation, context, target, lease) {
  return {
    phase: PHASE.UNINITIALIZED,
    cleanupRequested: invocation.cleanupRequested,
    context,
    target,
    lease,
    databaseName: context.databaseName,
    connection: null,
    ownerMarker: null,
    ownership: 'UNCLAIMED',
    attendanceCollection: null,
    initialTopologyValidated: false,
    indexPreflightPassed: false,
    activeScenarios: 0,
    scenariosStarted: 0,
    scenariosCompleted: 0,
    scenarioSuitePassed: false,
    transactionStates: [],
    reconciliationComplete: false,
    cleanupAttempted: false,
    cleanupFailure: false,
  };
}

function assertConnectionIsExactTarget(runState) {
  const connection = runState.connection;
  if (!connection || !connection.db ||
      connection.name !== runState.databaseName ||
      connection.db.databaseName !== runState.databaseName ||
      runState.target.databaseName !== runState.databaseName) {
    fail('CONNECTION_DATABASE_MISMATCH');
  }
}

async function openDedicatedConnection(uri, runState) {
  const connection = mongoose.createConnection(uri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
    readPreference: 'primary',
  });

  try {
    await connection.asPromise();
  } catch {
    await connection.close().catch(() => {});
    fail('CONNECTION_FAILED');
  }

  runState.connection = connection;
  assertConnectionIsExactTarget(runState);
  runState.phase = PHASE.CONNECTED;
  return connection;
}

async function issueHello(connection) {
  if (!connection || !connection.db) fail('CONNECTION_UNAVAILABLE');
  try {
    return await connection.db.admin().command({ hello: 1 });
  } catch {
    fail('TOPOLOGY_COMMAND_FAILED');
  }
}

async function validateInitialTopology(runState) {
  assertConnectionIsExactTarget(runState);
  const hello = await issueHello(runState.connection);
  try {
    guard.validateHelloResponseShape(hello, runState.target);
  } catch {
    fail('TOPOLOGY_PREFLIGHT_FAILED');
  }
  runState.initialTopologyValidated = true;
}

async function assertGeneratedDatabaseAbsent(runState) {
  assertConnectionIsExactTarget(runState);
  let result;
  try {
    result = await runState.connection.db.admin().listDatabases({
      filter: { name: runState.databaseName },
      nameOnly: true,
      authorizedDatabases: false,
    });
  } catch {
    fail('DATABASE_COLLISION_CHECK_FAILED');
  }
  if (!result || !Array.isArray(result.databases)) fail('DATABASE_COLLISION_CHECK_FAILED');
  if (result.databases.some(database => database && database.name === runState.databaseName)) {
    fail('GENERATED_DATABASE_ALREADY_EXISTS');
  }
}

function createOwnerCollection(runState) {
  assertConnectionIsExactTarget(runState);
  return runState.connection.db.collection(guard.OWNER_COLLECTION);
}

async function readOwnerMarker(runState) {
  assertConnectionIsExactTarget(runState);
  let marker;
  try {
    marker = await createOwnerCollection(runState).findOne(
      { _id: guard.OWNER_MARKER_ID },
      { maxTimeMS: CONNECT_TIMEOUT_MS, readConcern: { level: 'majority' } }
    );
  } catch {
    fail('OWNERSHIP_READBACK_FAILED');
  }
  return marker;
}

function markerMatchesThisRun(runState, marker) {
  return guard.isOwnershipMarkerShape(marker, runState.context.runId) &&
    runState.lease.matchesLeaseMarkerValues(marker);
}

async function reconcileOwnerMarker(runState) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let marker;
    try {
      marker = await readOwnerMarker(runState);
    } catch {
      runState.ownership = 'UNKNOWN';
      return false;
    }
    if (markerMatchesThisRun(runState, marker)) {
      runState.ownership = 'CLAIMED';
      runState.phase = PHASE.OWNERSHIP_CLAIMED;
      return true;
    }
    if (marker) {
      runState.ownership = 'NOT_OWNED';
      return false;
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
  }
  runState.ownership = 'UNKNOWN';
  return false;
}

async function claimDatabaseOwnership(runState) {
  await assertGeneratedDatabaseAbsent(runState);
  runState.ownerMarker = runState.lease.markerForInsert();
  runState.ownership = 'UNKNOWN';

  try {
    await createOwnerCollection(runState).insertOne(runState.ownerMarker, {
      writeConcern: { w: 'majority' },
    });
  } catch {
    // Insert acknowledgement can be lost after the write; only the direct read below can resolve it.
  }

  if (!await reconcileOwnerMarker(runState)) fail('OWNERSHIP_NOT_PROVEN');
}

function keyEntries(index) {
  if (!index || !index.key || typeof index.key !== 'object' || Array.isArray(index.key)) return [];
  return Object.entries(index.key);
}

function keysMatch(index, expected) {
  const actual = keyEntries(index);
  return actual.length === expected.length &&
    actual.every(([key, direction], position) =>
      key === expected[position][0] && direction === expected[position][1]);
}

function noUnexpectedIndexOptions(index) {
  const allowed = new Set(['v', 'key', 'name', 'ns', 'unique']);
  return Object.keys(index).every(key => allowed.has(key));
}

function attendanceIndexSetIsExpected(indexes) {
  if (!Array.isArray(indexes) || indexes.length !== 3) return false;
  if (indexes.some(index => !noUnexpectedIndexOptions(index))) return false;

  const idIndex = indexes.filter(index => index.name === '_id_' && keysMatch(index, ID_KEY));
  const logicalUnique = indexes.filter(index => keysMatch(index, LOGICAL_KEY) && index.unique === true);
  const classDate = indexes.filter(index => keysMatch(index, CLASS_DATE_KEY) && index.unique !== true);
  return idIndex.length === 1 &&
    idIndex[0].unique !== false &&
    logicalUnique.length === 1 &&
    classDate.length === 1;
}

async function preflightAttendanceIndexes(runState) {
  assertConnectionIsExactTarget(runState);
  const db = runState.connection.db;
  let collections;
  try {
    collections = await db.listCollections({ name: ATTENDANCE_COLLECTION }, { nameOnly: true }).toArray();
  } catch {
    fail('ATTENDANCE_COLLECTION_CHECK_FAILED');
  }
  if (!Array.isArray(collections) || collections.length !== 1) fail('ATTENDANCE_COLLECTION_MISSING');

  let indexes;
  try {
    indexes = await db.collection(ATTENDANCE_COLLECTION).listIndexes().toArray();
  } catch {
    fail('ATTENDANCE_INDEX_READ_FAILED');
  }
  if (!attendanceIndexSetIsExpected(indexes)) fail('ATTENDANCE_INDEX_STATE_UNEXPECTED');
  runState.attendanceCollection = db.collection(ATTENDANCE_COLLECTION);
  runState.indexPreflightPassed = true;
}

function schoolDateToInstant(dateOnly) {
  if (typeof dateOnly !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    fail('INVALID_SYNTHETIC_DATE');
  }
  const [year, month, day] = dateOnly.split('-').map(Number);
  const utcMidnight = new Date(0);
  utcMidnight.setUTCFullYear(year, month - 1, day);
  utcMidnight.setUTCHours(0, 0, 0, 0);
  if (utcMidnight.getUTCFullYear() !== year ||
      utcMidnight.getUTCMonth() !== month - 1 ||
      utcMidnight.getUTCDate() !== day) {
    fail('INVALID_SYNTHETIC_DATE');
  }
  return new Date(utcMidnight.getTime() - SCHOOL_UTC_OFFSET_MINUTES * 60 * 1000);
}

function makeAttendanceRecord(runState, className, status, subject = 'General') {
  const now = new Date();
  return Object.freeze({
    _id: new mongoose.Types.ObjectId(),
    student: new mongoose.Types.ObjectId(),
    class: className,
    date: schoolDateToInstant('2026-11-07'),
    status,
    subject,
    markedBy: new mongoose.Types.ObjectId(),
    remarks: `synthetic attendance integration run ${runState.context.runId}`,
    academicYear: '2026-2027',
    createdAt: now,
    updatedAt: now,
    __v: 0,
  });
}

function idString(value) {
  return value && typeof value.toString === 'function' ? value.toString() : String(value);
}

function valueMatches(actual, expected) {
  if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime();
  if (actual && expected && typeof actual.equals === 'function') return actual.equals(expected);
  return actual === expected;
}

function recordMatches(actual, expected) {
  return RECORD_FIELDS.every(field => valueMatches(actual[field], expected[field]));
}

async function readExpectedRecordSet(runState, candidates) {
  const ids = candidates.map(record => record._id);
  if (ids.length === 0) return [];
  return runState.attendanceCollection
    .find({ _id: { $in: ids } }, { readConcern: { level: 'majority' } })
    .toArray();
}

function recordSetMatches(actualRecords, expectedRecords) {
  if (actualRecords.length !== expectedRecords.length) return false;
  const actualById = new Map(actualRecords.map(record => [idString(record._id), record]));
  return expectedRecords.every(expected => {
    const actual = actualById.get(idString(expected._id));
    return actual && recordMatches(actual, expected);
  });
}

async function reconcileRecordSets(runState, expectedBefore, expectedAfter) {
  const actual = await readExpectedRecordSet(runState, [...expectedBefore, ...expectedAfter]);
  if (recordSetMatches(actual, expectedAfter)) return TRANSACTION_STATE.COMMITTED;
  if (recordSetMatches(actual, expectedBefore)) return TRANSACTION_STATE.ABORTED;
  return TRANSACTION_STATE.UNKNOWN;
}

async function executeTransaction(runState, label, work, reconcile) {
  const transaction = { label, state: TRANSACTION_STATE.NOT_STARTED };
  runState.transactionStates.push(transaction);
  let session;
  let operationError;

  try {
    session = await runState.connection.startSession();
    transaction.state = TRANSACTION_STATE.IN_PROGRESS;
    await session.withTransaction(() => work(session), TRANSACTION_OPTIONS);
    transaction.state = TRANSACTION_STATE.COMMITTED;
    return { transaction, error: null };
  } catch (error) {
    operationError = error;
  } finally {
    if (session) await session.endSession().catch(() => {});
  }

  if (transaction.state === TRANSACTION_STATE.NOT_STARTED) {
    fail('SESSION_START_FAILED');
  }
  if (operationError instanceof ExpectedAbort) {
    transaction.state = TRANSACTION_STATE.ABORTED;
    return { transaction, error: operationError };
  }

  let outcome = TRANSACTION_STATE.UNKNOWN;
  try {
    outcome = await reconcile();
  } catch {
    outcome = TRANSACTION_STATE.UNKNOWN;
  }
  transaction.state = outcome;
  if (outcome === TRANSACTION_STATE.UNKNOWN) fail('TRANSACTION_OUTCOME_UNKNOWN');
  return { transaction, error: operationError };
}

async function requirePersistedRecords(runState, records) {
  const actual = await readExpectedRecordSet(runState, records);
  if (!recordSetMatches(actual, records)) fail('SCENARIO_PERSISTENCE_MISMATCH');
}

async function requireRecordsAbsent(runState, records) {
  const actual = await readExpectedRecordSet(runState, records);
  if (actual.length !== 0) fail('SCENARIO_ROLLBACK_MISMATCH');
}

async function runScenario(runState, name, callback) {
  if (runState.ownership !== 'CLAIMED' || !runState.indexPreflightPassed) {
    fail('SCENARIO_PRECONDITION_FAILED');
  }
  runState.activeScenarios += 1;
  runState.scenariosStarted += 1;
  runState.phase = PHASE.SCENARIOS_RUNNING;
  try {
    await callback();
    runState.scenariosCompleted += 1;
    console.log(`Attendance integration scenario passed: ${name}`);
  } finally {
    runState.activeScenarios -= 1;
    if (runState.activeScenarios === 0) runState.phase = PHASE.SCENARIOS_QUIESCENT;
  }
}

async function scenarioSingleRecordCommit(runState) {
  const record = makeAttendanceRecord(runState, '10', 'Present');
  const outcome = await executeTransaction(
    runState,
    'single-record-commit',
    session => runState.attendanceCollection.insertOne(record, { session }),
    () => reconcileRecordSets(runState, [], [record])
  );
  if (outcome.transaction.state !== TRANSACTION_STATE.COMMITTED) fail('SINGLE_RECORD_COMMIT_FAILED');
  await requirePersistedRecords(runState, [record]);
}

async function scenarioClassBatchCommit(runState) {
  const records = [
    makeAttendanceRecord(runState, '9', 'Present'),
    makeAttendanceRecord(runState, '9', 'Absent'),
    makeAttendanceRecord(runState, '9', 'Late'),
  ];
  const outcome = await executeTransaction(
    runState,
    'class-batch-commit',
    session => runState.attendanceCollection.bulkWrite(
      records.map(document => ({ insertOne: { document } })),
      { session, ordered: true }
    ),
    () => reconcileRecordSets(runState, [], records)
  );
  if (outcome.transaction.state !== TRANSACTION_STATE.COMMITTED) fail('CLASS_BATCH_COMMIT_FAILED');
  await requirePersistedRecords(runState, records);
}

async function scenarioMidBatchRollback(runState) {
  const records = [
    makeAttendanceRecord(runState, '8', 'Present'),
    makeAttendanceRecord(runState, '8', 'Absent'),
  ];
  const outcome = await executeTransaction(
    runState,
    'mid-batch-rollback',
    async session => {
      await runState.attendanceCollection.insertOne(records[0], { session });
      throw new ExpectedAbort('INJECTED_MID_BATCH_FAILURE');
    },
    () => reconcileRecordSets(runState, [], records)
  );
  if (outcome.transaction.state !== TRANSACTION_STATE.ABORTED ||
      !(outcome.error instanceof ExpectedAbort)) fail('INJECTED_ROLLBACK_NOT_CONFIRMED');
  await requireRecordsAbsent(runState, records);
}

async function scenarioDuplicateKeyProtection(runState) {
  const original = makeAttendanceRecord(runState, '7', 'Present', 'Mathematics');
  const duplicate = Object.freeze({ ...original, _id: new mongoose.Types.ObjectId(), status: 'Absent' });
  const baseline = await executeTransaction(
    runState,
    'duplicate-key-baseline',
    session => runState.attendanceCollection.insertOne(original, { session }),
    () => reconcileRecordSets(runState, [], [original])
  );
  if (baseline.transaction.state !== TRANSACTION_STATE.COMMITTED) fail('DUPLICATE_BASELINE_FAILED');

  const outcome = await executeTransaction(
    runState,
    'duplicate-key-rejection',
    session => runState.attendanceCollection.insertOne(duplicate, { session }),
    () => reconcileRecordSets(runState, [original], [original, duplicate])
  );
  if (outcome.transaction.state !== TRANSACTION_STATE.ABORTED ||
      !outcome.error ||
      (outcome.error.code !== 11000 && outcome.error.codeName !== 'DuplicateKey')) {
    fail('DUPLICATE_LOGICAL_RECORD_WAS_NOT_REJECTED');
  }
  await requirePersistedRecords(runState, [original]);
  await requireRecordsAbsent(runState, [duplicate]);
}

function createAsyncBarrier(participantCount, timeoutMs) {
  let arrived = 0;
  let timer;
  let release;
  let reject;
  const barrier = new Promise((resolve, rejectPromise) => {
    release = resolve;
    reject = rejectPromise;
  });
  barrier.catch(() => {});

  return async function waitForParticipants() {
    arrived += 1;
    if (arrived === 1) {
      timer = setTimeout(() => reject(new RunnerFailure('CONCURRENCY_BARRIER_TIMEOUT')), timeoutMs);
    }
    if (arrived === participantCount) {
      clearTimeout(timer);
      release();
    }
    await barrier;
  };
}

async function scenarioConcurrentStaleUpdates(runState) {
  const baseline = makeAttendanceRecord(runState, '6', 'Present', 'Science');
  const seed = await executeTransaction(
    runState,
    'stale-update-baseline',
    session => runState.attendanceCollection.insertOne(baseline, { session }),
    () => reconcileRecordSets(runState, [], [baseline])
  );
  if (seed.transaction.state !== TRANSACTION_STATE.COMMITTED) fail('STALE_UPDATE_BASELINE_FAILED');

  const candidates = [
    Object.freeze({ ...baseline, status: 'Absent', __v: baseline.__v + 1, updatedAt: new Date() }),
    Object.freeze({ ...baseline, status: 'Late', __v: baseline.__v + 1, updatedAt: new Date() }),
  ];
  const waitForBothUpdates = createAsyncBarrier(2, CONNECT_TIMEOUT_MS);
  const attemptResults = await Promise.allSettled(candidates.map((candidate, index) => executeTransaction(
    runState,
    `concurrent-stale-update-${index + 1}`,
    async session => {
      await waitForBothUpdates();
      const result = await runState.attendanceCollection.updateOne(
        { _id: baseline._id, __v: baseline.__v },
        { $set: { status: candidate.status, updatedAt: candidate.updatedAt }, $inc: { __v: 1 } },
        { session }
      );
      if (result.matchedCount !== 1) throw new StaleAttendanceConflict();
    },
    async () => TRANSACTION_STATE.UNKNOWN
  )));

  const finalRecord = await runState.attendanceCollection.findOne(
    { _id: baseline._id },
    { readConcern: { level: 'majority' } }
  );
  if (!finalRecord || finalRecord.__v !== 1 ||
      !candidates.some(candidate => candidate.status === finalRecord.status)) {
    fail('CONCURRENT_STALE_UPDATE_OUTCOME_UNKNOWN');
  }

  const winnerIndex = candidates.findIndex(candidate => candidate.status === finalRecord.status);
  const attempts = runState.transactionStates.filter(transaction =>
    transaction.label.startsWith('concurrent-stale-update-'));
  if (attemptResults.length !== 2 || attempts.length !== 2) {
    fail('CONCURRENT_STALE_UPDATE_OUTCOME_UNKNOWN');
  }
  const previouslyCommitted = attempts.findIndex(transaction =>
    transaction.state === TRANSACTION_STATE.COMMITTED);
  if (previouslyCommitted !== -1 && previouslyCommitted !== winnerIndex) {
    fail('CONCURRENT_STALE_UPDATE_OUTCOME_UNKNOWN');
  }
  attempts.forEach((result, index) => {
    if (result.state === TRANSACTION_STATE.UNKNOWN) {
      result.state = index === winnerIndex
        ? TRANSACTION_STATE.COMMITTED
        : TRANSACTION_STATE.ABORTED;
    }
  });

  const committed = attempts.filter(result => result.state === TRANSACTION_STATE.COMMITTED).length;
  const aborted = attempts.filter(result => result.state === TRANSACTION_STATE.ABORTED).length;
  const winnerResult = attemptResults[winnerIndex];
  const loserResult = attemptResults[1 - winnerIndex];
  if (committed !== 1 || aborted !== 1 || finalRecord.__v !== baseline.__v + 1) {
    fail('CONCURRENT_STALE_UPDATE_CONFLICT_NOT_ENFORCED');
  }
  if (winnerResult.status !== 'fulfilled' || winnerResult.value.error !== null ||
      loserResult.status !== 'fulfilled' ||
      !(loserResult.value.error instanceof StaleAttendanceConflict)) {
    fail('CONCURRENT_STALE_UPDATE_CONFLICT_NOT_CONFIRMED');
  }
}

async function runAttendanceScenarios(runState) {
  const scenarios = [
    ['single-record-commit', () => scenarioSingleRecordCommit(runState)],
    ['class-batch-commit', () => scenarioClassBatchCommit(runState)],
    ['mid-batch-rollback', () => scenarioMidBatchRollback(runState)],
    ['duplicate-key-protection', () => scenarioDuplicateKeyProtection(runState)],
    ['concurrent-stale-updates', () => scenarioConcurrentStaleUpdates(runState)],
  ];

  for (const [name, callback] of scenarios) {
    await runScenario(runState, name, callback);
  }
  runState.scenarioSuitePassed = true;
  runState.reconciliationComplete = runState.transactionStates.every(transaction =>
    transaction.state === TRANSACTION_STATE.NOT_STARTED ||
    transaction.state === TRANSACTION_STATE.COMMITTED ||
    transaction.state === TRANSACTION_STATE.ABORTED);
  if (!runState.reconciliationComplete) fail('TRANSACTION_RECONCILIATION_INCOMPLETE');
  runState.phase = PHASE.RECONCILIATION_COMPLETE;
}

function assertTransactionsCertain(runState) {
  if (runState.transactionStates.some(transaction =>
    transaction.state === TRANSACTION_STATE.IN_PROGRESS ||
    transaction.state === TRANSACTION_STATE.UNKNOWN)) {
    fail('TRANSACTION_OUTCOME_NOT_CERTAIN');
  }
  if (!runState.reconciliationComplete) fail('TRANSACTION_RECONCILIATION_INCOMPLETE');
}

async function verifyOwnershipForCleanup(runState) {
  if (runState.ownership !== 'CLAIMED') fail('CLEANUP_OWNERSHIP_NOT_PROVEN');
  const marker = await readOwnerMarker(runState);
  if (!markerMatchesThisRun(runState, marker)) fail('CLEANUP_OWNERSHIP_READBACK_MISMATCH');
}

async function performOptInCleanup(runState) {
  if (!runState.cleanupRequested || runState.cleanupAttempted) fail('CLEANUP_NOT_AUTHORIZED');
  if (!runState.scenarioSuitePassed || runState.phase !== PHASE.RECONCILIATION_COMPLETE ||
      runState.activeScenarios !== 0 || runState.scenariosStarted !== runState.scenariosCompleted) {
    fail('CLEANUP_SCENARIOS_NOT_QUIESCENT');
  }
  assertTransactionsCertain(runState);
  await verifyOwnershipForCleanup(runState);

  assertConnectionIsExactTarget(runState);
  const freshHello = await issueHello(runState.connection);
  let topologyValidation;
  try {
    topologyValidation = guard.validateHelloResponseShape(freshHello, runState.target);
  } catch {
    fail('CLEANUP_TOPOLOGY_PREFLIGHT_FAILED');
  }

  // All gates above are synchronous after the fresh hello validation. Consume terminal state before deletion.
  runState.phase = PHASE.CLEANUP_PREFLIGHT_COMPLETE;
  if (!runState.lease.retireRunAfterTopologyValidation(topologyValidation)) {
    fail('CLEANUP_TOPOLOGY_VALIDATION_REJECTED');
  }
  runState.cleanupAttempted = true;
  runState.phase = PHASE.CLEANUP_ATTEMPTED;

  try {
    const dropped = await runState.connection.dropDatabase();
    if (dropped !== true) fail('CLEANUP_RESULT_UNCERTAIN');
    runState.phase = PHASE.CLEANED;
    console.log('Attendance integration test database cleanup completed.');
  } catch {
    runState.cleanupFailure = true;
    runState.phase = PHASE.RETAINED_TERMINAL_FAILURE;
    fail('CLEANUP_RESULT_UNCERTAIN');
  }
}

function allTransactionStatesCertain(runState) {
  return runState.transactionStates.every(transaction =>
    transaction.state !== TRANSACTION_STATE.IN_PROGRESS &&
    transaction.state !== TRANSACTION_STATE.UNKNOWN);
}

async function main(argv) {
  requireTestEnvironment();
  const invocation = parseInvocation(argv);
  const context = guard.createRunContext();
  const uri = guard.buildTestUri(context);
  const target = guard.validateTestUri(uri, context);
  const lease = guard.createOwnershipLease(context);
  const runState = createRunState(invocation, context, target, lease);
  runState.phase = PHASE.TARGET_GENERATED;

  try {
    await openDedicatedConnection(uri, runState);
    await validateInitialTopology(runState);
    await claimDatabaseOwnership(runState);
    console.log(`Attendance integration test database ownership claimed: ${runState.databaseName}`);
    await preflightAttendanceIndexes(runState);
    await runAttendanceScenarios(runState);

    if (runState.cleanupRequested) {
      await performOptInCleanup(runState);
    } else {
      runState.phase = PHASE.RETAINED;
      console.log('Attendance integration test database retained; cleanup was not requested.');
    }
  } catch (error) {
    if (runState.phase !== PHASE.CLEANUP_ATTEMPTED && runState.phase !== PHASE.CLEANED) {
      runState.phase = PHASE.RETAINED_TERMINAL_FAILURE;
    }
    const code = error instanceof RunnerFailure ? error.code : 'RUNNER_FAILED';
    const suffix = runState.ownership === 'CLAIMED'
      ? `; retain and investigate ${runState.databaseName}`
      : '; no scenario or cleanup was authorized';
    console.error(`Attendance integration runner stopped (${code})${suffix}.`);
    process.exitCode = 1;
  } finally {
    if (runState.connection) await runState.connection.close().catch(() => {});
    if (!allTransactionStatesCertain(runState)) process.exitCode = 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(() => {
    console.error('Attendance integration runner stopped before database access.');
    process.exitCode = 1;
  });
}

