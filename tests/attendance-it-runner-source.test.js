'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runnerPath = path.join(__dirname, '..', 'scripts', 'attendance-it-runner.js');
const guardPath = path.join(__dirname, '..', 'scripts', 'attendance-it-guard.js');
const runnerSource = fs.readFileSync(runnerPath, 'utf8');
const guardSource = fs.readFileSync(guardPath, 'utf8');

function functionSource(source, name, nextDeclaration) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected private function ${name}`);
  const end = source.indexOf(`\nfunction ${nextDeclaration}(`, start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

test('CLI accepts only the exact cleanup opt-in and defaults to database retention', () => {
  const parser = functionSource(runnerSource, 'parseInvocation', 'requireTestEnvironment');
  assert.match(parser, /argv\.length === 0[\s\S]*cleanupRequested: false/);
  assert.match(parser, /argv\.length === 1 && argv\[0\] === '--cleanup'[\s\S]*cleanupRequested: true/);
  assert.match(parser, /fail\('INVALID_ARGUMENTS'\)/);
  assert.match(runnerSource, /process\.env\.NODE_ENV !== 'test'/);
  assert.doesNotMatch(runnerSource, /process\.env\.(MONGO_URI|MONGODB_URI)|dotenv|config\/env|server\.js/);
  assert.doesNotMatch(runnerSource, /module\.exports\s*=/);
});

test('runner keeps marker read-back inside a direct target database read', () => {
  const reader = functionSource(runnerSource, 'readOwnerMarker', 'markerMatchesThisRun');
  const claimant = functionSource(runnerSource, 'claimDatabaseOwnership', 'keyEntries');
  assert.match(reader, /createOwnerCollection\(runState\)|connection\.db\.collection\(guard\.OWNER_COLLECTION\)/);
  assert.match(reader, /findOne\(\s*\{\s*_id:\s*guard\.OWNER_MARKER_ID\s*\}/);
  assert.match(claimant, /insertOne\(runState\.ownerMarker/);
  assert.match(claimant, /reconcileOwnerMarker\(runState\)/);
  assert.doesNotMatch(claimant, /upsert/);
  assert.match(runnerSource, /markerMatchesThisRun\(runState, marker\)/);
  assert.doesNotMatch(runnerSource, /createReadBackEvidence|readBackEvidence/);
  assert.match(guardSource, /matchesLeaseMarkerValues/);
  assert.doesNotMatch(guardSource, /createReadBackEvidence|cleanupEligible/);
});

test('cleanup performs a new hello command and does not reuse initial topology state', () => {
  const cleanup = functionSource(runnerSource, 'performOptInCleanup', 'allTransactionStatesCertain');
  assert.match(cleanup, /await issueHello\(runState\.connection\)/);
  assert.match(cleanup, /validateHelloResponseShape\(freshHello, runState\.target\)/);
  assert.doesNotMatch(cleanup, /initialTopologyValidated|initialHello/);
});

test('cleanup is absent from default invocation and its consent is captured from CLI parsing', () => {
  const stateFactory = functionSource(runnerSource, 'createRunState', 'assertConnectionIsExactTarget');
  const entry = runnerSource.slice(runnerSource.indexOf('async function main('));
  assert.match(stateFactory, /cleanupRequested: invocation\.cleanupRequested/);
  assert.match(entry, /if \(runState\.cleanupRequested\)\s*\{\s*await performOptInCleanup\(runState\)/);
  assert.match(entry, /else\s*\{\s*runState\.phase = PHASE\.RETAINED/);
  assert.doesNotMatch(runnerSource, /cleanupRequested\s*:\s*process\.env/);
});

test('cleanup requires ownership, quiescent scenarios, and certain transaction outcomes', () => {
  const cleanup = functionSource(runnerSource, 'performOptInCleanup', 'allTransactionStatesCertain');
  const certainty = functionSource(runnerSource, 'assertTransactionsCertain', 'verifyOwnershipForCleanup');
  assert.match(cleanup, /!runState\.cleanupRequested/);
  assert.match(cleanup, /runState\.activeScenarios !== 0/);
  assert.match(cleanup, /verifyOwnershipForCleanup\(runState\)/);
  assert.match(functionSource(runnerSource, 'verifyOwnershipForCleanup', ''), /runState\.ownership !== 'CLAIMED'/);
  assert.match(cleanup, /assertTransactionsCertain\(runState\)/);
  assert.match(certainty, /TRANSACTION_STATE\.UNKNOWN/);
  assert.match(certainty, /TRANSACTION_STATE\.IN_PROGRESS/);
  assert.match(certainty, /runState\.reconciliationComplete/);
});

test('cleanup authorization is private, terminal, and attempted at most once', () => {
  const cleanup = functionSource(runnerSource, 'performOptInCleanup', 'allTransactionStatesCertain');
  assert.equal((runnerSource.match(/\.dropDatabase\(\)/g) || []).length, 1);
  const consumeAt = cleanup.indexOf('retireRunAfterTopologyValidation');
  const attemptAt = cleanup.indexOf('runState.cleanupAttempted = true');
  const deletionAt = cleanup.indexOf('await runState.connection.dropDatabase()');
  assert.ok(consumeAt >= 0 && attemptAt > consumeAt && deletionAt > attemptAt);
  assert.match(cleanup, /runState\.cleanupAttempted\) fail\('CLEANUP_NOT_AUTHORIZED'\)/);
  assert.doesNotMatch(runnerSource, /function (authorizeCleanup|cleanupEligible|deleteDatabaseByPrefix)/);
});

test('only the generated database is used and uncertain ownership blocks scenarios', () => {
  const targetCheck = functionSource(runnerSource, 'assertConnectionIsExactTarget', 'openDedicatedConnection');
  const scenario = functionSource(runnerSource, 'runScenario', 'scenarioSingleRecordCommit');
  const main = functionSource(runnerSource, 'main', '');
  assert.match(targetCheck, /connection\.db\.databaseName !== runState\.databaseName/);
  assert.match(scenario, /runState\.ownership !== 'CLAIMED'/);
  assert.match(main, /await claimDatabaseOwnership\(runState\)[\s\S]*await runAttendanceScenarios\(runState\)/);
  assert.match(main, /await preflightAttendanceIndexes\(runState\)/);
  const cleanup = functionSource(runnerSource, 'performOptInCleanup', 'allTransactionStatesCertain');
  assert.match(cleanup, /assertConnectionIsExactTarget\(runState\)[\s\S]*await runState\.connection\.dropDatabase\(\)/);
  assert.doesNotMatch(cleanup, /listDatabases/);
});

