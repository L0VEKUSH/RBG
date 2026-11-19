'use strict';

// This helper has no database or queue side effects. Install lifecycle handlers
// before loading modules that can instantiate a BullMQ Queue or connect MongoDB.
const { createEmailWorkerLifecycle, safeErrorCode } = require('../utils/email-worker-lifecycle');

const lifecycle = createEmailWorkerLifecycle({
  processObject: process,
  exit: code => process.exit(code),
  log: message => console.error(message),
});
const context = lifecycle.context;
const runtime = {};

const startupStages = [
  {
    name: 'configuration',
    run() {
      runtime.mongoose = require('mongoose');
      const config = require('../config/env');
      runtime.MONGO_URI = config.MONGO_URI;
      runtime.NODE_ENV = config.NODE_ENV;
      runtime.mongooseOptions = require('../utils/mongoose-connection-options')
        .configureMongooseForEnvironment(runtime.mongoose, runtime.NODE_ENV);

      // SMTP config validation is local only. It does not create a transporter
      // or make a network request.
      runtime.validateEmailConfiguration = require('../utils/email-production-config')
        .validateProductionEmailEnvironment;

      const redis = require('../queues/redis.connection');
      if (!redis.redisUrl || !redis.connection) {
        const error = new Error('REDIS_CONFIGURATION_REQUIRED');
        error.safeCode = 'REDIS_CONFIGURATION_REQUIRED';
        throw error;
      }
      runtime.redisConnection = redis.connection;
      runtime.Worker = require('bullmq').Worker;
      runtime.assertProductionDatabaseReady = require('../utils/production-database-readiness')
        .assertProductionDatabaseReady;
      runtime.loadProductionModels = require('../utils/production-model-inventory').loadProductionModels;
      runtime.indexPolicy = require('../utils/mongoose-index-policy');
    },
  },
  {
    name: 'database, readiness, recovery, and reconciliation preflight',
    async run() {
      const { runEmailWorkerPreflight } = require('../utils/email-worker-startup');
      const result = await runEmailWorkerPreflight({
        validateConfiguration: async () => runtime.validateEmailConfiguration(process.env, runtime.NODE_ENV),
        connectDatabase: async () => {
          // A rejected connect attempt may still leave Mongoose transitioning;
          // cleanup will disconnect after the attempt settles.
          context.markMongoConnectAttempted(() => runtime.mongoose.disconnect());
          await runtime.mongoose.connect(runtime.MONGO_URI, runtime.mongooseOptions);
        },
        verifyDatabaseReadiness: async () => {
          if (runtime.NODE_ENV === 'production') {
            const models = runtime.loadProductionModels(runtime.mongoose);
            await runtime.assertProductionDatabaseReady({
              models,
              database: runtime.mongoose.connection.db,
              indexCheck: runtime.indexPolicy.assertDeclaredIndexesPresent,
            });
          }
          runtime.EmailDelivery = runtime.mongoose.models.EmailDelivery ||
            require('../models/EmailDelivery');
        },
        prepareEmailIndexes: () => runtime.indexPolicy.prepareModelIndexes(runtime.EmailDelivery),
        initializeServices: async () => {
          // Reconciliation can enqueue work, so construct and register its
          // queue before recovery/reconciliation and immediately own its close.
          const emailQueue = require('../queues/email.queue');
          context.registerQueue(emailQueue.queue);
          if (!emailQueue.queue) {
            const error = new Error('REDIS_QUEUE_UNAVAILABLE');
            error.safeCode = 'REDIS_QUEUE_UNAVAILABLE';
            throw error;
          }
          emailQueue.queue.on('error', (error) => {
            if (context.isShutdownRequested) {
              context.recordCleanupFailure('BullMQ queue Redis connection', error);
            } else {
              console.error(`Email queue error [${safeErrorCode(error)}]`);
            }
          });

          const delivery = require('../services/email-delivery.service');
          const admission = require('../services/admission.service');
          runtime.processDelivery = delivery.processDelivery;
          runtime.reconcileDeliveries = delivery.reconcileDeliveries;
          runtime.recoverStaleAdmissionSagas = admission.recoverStaleAdmissionSagas;
        },
        recoverStaleAdmissionSagas: () => runtime.recoverStaleAdmissionSagas(),
        reconcileDeliveries: () => runtime.reconcileDeliveries(),
        shouldContinue: () => !context.isShutdownRequested,
      });
      return result;
    },
  },
  {
    name: 'consumer construction',
    run() {
      const worker = new runtime.Worker('erp-email-delivery', async (job) => {
        await runtime.processDelivery(job.data.deliveryId);
      }, {
        connection: runtime.redisConnection,
        prefix: process.env.EMAIL_QUEUE_PREFIX || 'erp-email:',
        concurrency: 2,
        // Hold off job intake until readiness and the shutdown guard pass.
        autorun: false,
      });
      context.registerWorker(worker);
      worker.on('error', (error) => {
        if (context.isShutdownRequested) {
          context.recordCleanupFailure('BullMQ worker Redis connection', error);
        } else {
          console.error(`Email worker error [${safeErrorCode(error)}]`);
        }
      });
      worker.on('failed', (job, error) => console.error(
        `Email job failed [${safeErrorCode(error)}] job=${job && job.id ? job.id : 'unknown'}`
      ));
      worker.on('stalled', (jobId) => console.error(`Email job stalled job=${jobId}`));
      worker.on('ready', () => console.log('Email worker Redis connection ready'));
      runtime.worker = worker;
    },
  },
  {
    name: 'consumer readiness',
    async run() {
      const result = await context.waitForShutdownOr(runtime.worker.waitUntilReady());
      if (result.status === 'shutdown') return;
    },
  },
  {
    name: 'consumer start',
    run() {
      // Worker.run() is attached immediately so its rejection is always handled.
      runtime.workerRunPromise = runtime.worker.run();
      runtime.workerRunPromise.catch((error) => {
        void context.fail(error, 'consumer-runtime');
      });
    },
  },
  {
    name: 'worker timers',
    run() {
      const reconcileEvery = Math.max(1000, Number.parseInt(process.env.EMAIL_RECONCILE_MS, 10) || 30000);
      const reconcileTimer = setInterval(() => {
        if (context.isShutdownRequested) return;
        const task = Promise.resolve()
          .then(() => runtime.recoverStaleAdmissionSagas())
          .then(() => context.isShutdownRequested ? undefined : runtime.reconcileDeliveries())
          .catch((error) => console.error(`Email reconciliation failed [${safeErrorCode(error)}]`));
        context.trackInFlightTask(task);
      }, reconcileEvery);
      reconcileTimer.unref();
      context.registerTimer(reconcileTimer);

      const heartbeatTimer = setInterval(() => {
        if (context.isShutdownRequested) return;
        const task = Promise.resolve().then(() => runtime.worker.client).then((client) => {
          if (context.isShutdownRequested) return;
          const redisStatus = client && client.status ? client.status : 'unknown';
          const mongoStatus = runtime.mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
          console.log(`Email worker health worker=${runtime.worker.isRunning() ? 'running' : 'stopped'} redis=${redisStatus} mongo=${mongoStatus}`);
        }).catch((error) => console.error(`Email worker health check failed [${safeErrorCode(error)}]`));
        context.trackInFlightTask(task);
      }, 60000);
      heartbeatTimer.unref();
      context.registerTimer(heartbeatTimer);
    },
  },
];

void lifecycle.start(startupStages).then((result) => {
  if (result.status === 'ready') console.log('Email worker ready');
}).catch(() => {
  // createEmailWorkerLifecycle reports only safe error codes and exits nonzero
  // after attempting cleanup; this catch prevents an unhandled rejection.
});
