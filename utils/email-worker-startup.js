'use strict';

async function runEmailWorkerPreflight({
  validateConfiguration,
  connectDatabase,
  verifyDatabaseReadiness,
  prepareEmailIndexes,
  initializeServices,
  recoverStaleAdmissionSagas,
  reconcileDeliveries,
  shouldContinue = () => true,
}) {
  const steps = [
    validateConfiguration,
    connectDatabase,
    verifyDatabaseReadiness,
    prepareEmailIndexes,
    ...(initializeServices ? [initializeServices] : []),
    recoverStaleAdmissionSagas,
    reconcileDeliveries,
  ];
  if (steps.some(step => typeof step !== 'function') || typeof shouldContinue !== 'function') {
    throw new TypeError('Email worker startup steps are required');
  }
  for (const step of steps) {
    if (!shouldContinue()) return { status: 'shutdown' };
    await step();
    if (!shouldContinue()) return { status: 'shutdown' };
  }
  return { status: 'ready' };
}

module.exports = { runEmailWorkerPreflight };
