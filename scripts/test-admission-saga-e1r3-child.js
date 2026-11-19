'use strict';

const assert = require('assert');

if (process.env.NODE_ENV !== 'test' || process.env.ALLOW_E1R3_TEST_WRITES !== '1') {
  throw new Error('Refusing E1-R3 child writes without the explicit test guard.');
}

const mongoUri = process.env.MONGO_TEST_URI;
assert(mongoUri, 'MONGO_TEST_URI is required');
const parsedMongoUri = new URL(mongoUri);
const databaseName = parsedMongoUri.pathname.replace(/^\/+/, '');
assert(['localhost', '127.0.0.1', '::1'].includes(parsedMongoUri.hostname), 'MongoDB tests only permit localhost');
assert(/^erp_security_e1r3_[A-Za-z0-9_-]+$/.test(databaseName), 'Mongo database must be named erp_security_e1r3_*');
assert(process.env.E1R3_CHILD_ADMISSION_ID, 'E1R3_CHILD_ADMISSION_ID is required');
assert(process.env.E1R3_CHILD_PAUSE_POINT, 'E1R3_CHILD_PAUSE_POINT is required');

process.env.REDIS_URL = '';
process.env.EMAIL_TRANSPORT = 'json';

const mongoose = require('mongoose');
const admissionService = require('../services/admission.service');

async function main() {
  await mongoose.connect(mongoUri);
  admissionService.setSagaTestHook(async (point, context) => {
    if (point !== process.env.E1R3_CHILD_PAUSE_POINT) return;
    process.send({
      type: 'paused',
      point,
      sagaId: context.sagaId,
      generation: context.generation || context.ownerGeneration,
    });
    await new Promise(() => {});
  });
  await admissionService.admitStudent(process.env.E1R3_CHILD_ADMISSION_ID);
  throw new Error('Child admission unexpectedly completed before its termination failpoint.');
}

main().catch((error) => {
  if (process.connected) process.send({ type: 'child-error', code: error && error.code });
  process.exitCode = 1;
  mongoose.disconnect().catch(() => {});
});
