'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runEmailWorkerPreflight } = require('../utils/email-worker-startup');

test('worker validates configuration and completes database checks before saga recovery and reconciliation', async () => {
  const calls = [];
  await runEmailWorkerPreflight({
    validateConfiguration: async () => calls.push('configuration'),
    connectDatabase: async () => calls.push('mongo'),
    verifyDatabaseReadiness: async () => calls.push('collections-and-indexes'),
    prepareEmailIndexes: async () => calls.push('email-indexes'),
    recoverStaleAdmissionSagas: async () => calls.push('saga-recovery'),
    reconcileDeliveries: async () => calls.push('email-reconciliation'),
  });
  assert.deepEqual(calls, [
    'configuration',
    'mongo',
    'collections-and-indexes',
    'email-indexes',
    'saga-recovery',
    'email-reconciliation',
  ]);
});

test('worker startup stops at the first failed gate and does not recover or reconcile', async () => {
  const calls = [];
  await assert.rejects(runEmailWorkerPreflight({
    validateConfiguration: async () => { calls.push('configuration'); throw new Error('CONFIG_BLOCKED'); },
    connectDatabase: async () => calls.push('mongo'),
    verifyDatabaseReadiness: async () => calls.push('readiness'),
    prepareEmailIndexes: async () => calls.push('indexes'),
    recoverStaleAdmissionSagas: async () => calls.push('saga-recovery'),
    reconcileDeliveries: async () => calls.push('email-reconciliation'),
  }), /CONFIG_BLOCKED/);
  assert.deepEqual(calls, ['configuration']);
});

test('worker preflight stops after a signal during database readiness', async () => {
  const calls = [];
  let continueStartup = true;
  const result = await runEmailWorkerPreflight({
    validateConfiguration: async () => calls.push('configuration'),
    connectDatabase: async () => calls.push('mongo'),
    verifyDatabaseReadiness: async () => {
      calls.push('readiness-start');
      continueStartup = false;
      calls.push('readiness-finish');
    },
    prepareEmailIndexes: async () => calls.push('indexes'),
    initializeServices: async () => calls.push('services'),
    recoverStaleAdmissionSagas: async () => calls.push('recovery'),
    reconcileDeliveries: async () => calls.push('reconciliation'),
    shouldContinue: () => continueStartup,
  });
  assert.deepEqual(calls, ['configuration', 'mongo', 'readiness-start', 'readiness-finish']);
  assert.deepEqual(result, { status: 'shutdown' });
});

test('worker preflight constructs queue services before recovery and reconciliation', async () => {
  const calls = [];
  await runEmailWorkerPreflight({
    validateConfiguration: async () => calls.push('configuration'),
    connectDatabase: async () => calls.push('mongo'),
    verifyDatabaseReadiness: async () => calls.push('readiness'),
    prepareEmailIndexes: async () => calls.push('indexes'),
    initializeServices: async () => calls.push('queue-services'),
    recoverStaleAdmissionSagas: async () => calls.push('recovery'),
    reconcileDeliveries: async () => calls.push('reconciliation'),
  });
  assert.deepEqual(calls, [
    'configuration', 'mongo', 'readiness', 'indexes', 'queue-services', 'recovery', 'reconciliation',
  ]);
});

test('worker runs its preflight before constructing the BullMQ consumer', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'email-worker.js'), 'utf8');
  const lifecycle = fs.readFileSync(path.join(__dirname, '..', 'utils', 'email-worker-lifecycle.js'), 'utf8');
  const startup = source.indexOf('await runEmailWorkerPreflight');
  const consumerConstruction = source.indexOf('new runtime.Worker', startup);
  assert.ok(startup >= 0);
  assert.ok(startup < consumerConstruction);
  assert.ok(source.indexOf('validateConfiguration:', startup) < source.indexOf('recoverStaleAdmissionSagas:', startup));
  assert.ok(source.indexOf('require(\'../utils/email-worker-lifecycle\')') < source.indexOf('lifecycle.start(startupStages)'));
  const topLevel = source.slice(0, source.indexOf('const startupStages'));
  assert.doesNotMatch(topLevel, /require\(['"](?:mongoose|bullmq|\.\.\/queues\/email\.queue|\.\.\/services\/email-delivery\.service)/);
  assert.match(source, /autorun:\s*false/);
  assert.ok(source.indexOf('waitUntilReady()') < source.indexOf('runtime.worker.run()'));
  assert.match(lifecycle, /processObject\.on\('SIGTERM'/);
  assert.match(lifecycle, /processObject\.on\('SIGINT'/);
});
