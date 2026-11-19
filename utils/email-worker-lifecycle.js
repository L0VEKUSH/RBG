'use strict';

/*
 * Resource ownership for this worker process:
 * - BullMQ Worker owns its own Redis clients; Worker.close() drains jobs and
 *   closes those clients.
 * - The email BullMQ Queue owns a separate Redis client; Queue.close() closes it.
 * - queues/redis.connection exports connection options only. There is no
 *   standalone Redis client or QueueEvents instance in this process.
 * - Mongoose owns its default connection after connect is attempted.
 * - This lifecycle owns interval timers and waits for registered maintenance
 *   tasks to settle.
 *
 * Shutdown order is timers, Worker, in-flight maintenance, Queue, any separately
 * registered Redis resources, then Mongoose. The Worker close starts as soon as
 * shutdown is requested so it stops fetching new jobs immediately.
 */

function safeErrorCode(error) {
  const candidate = error && (error.safeCode || error.code || error.name);
  return typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(candidate)
    ? candidate
    : 'WORKER_ERROR';
}

function safeLabel(label) {
  return typeof label === 'string' && /^[A-Za-z0-9 _-]{1,48}$/.test(label)
    ? label
    : 'worker-resource';
}

function createEmailWorkerLifecycle({ processObject = process, exit, log = () => {} }) {
  if (!processObject || typeof processObject.on !== 'function' || typeof exit !== 'function') {
    throw new TypeError('Worker process lifecycle dependencies are required');
  }

  let shutdownRequested = false;
  let shutdownReason = null;
  let exitCode = 0;
  let startPromise = null;
  let shutdownPromise = null;
  let activeStage = null;
  let startupError = null;
  let exitCalled = false;
  let workerClosePromise = null;
  let mongoConnectAttempted = false;
  let mongoDisconnect;
  let queueClose;
  const redisClosers = [];
  const timers = new Set();
  const inFlightTasks = new Set();
  const cleanupErrors = [];
  let resolveShutdownRequested;
  const shutdownRequestedPromise = new Promise((resolve) => {
    resolveShutdownRequested = resolve;
  });

  const safeLog = (message) => {
    try { log(message); } catch (_) { /* Logging must not interrupt cleanup. */ }
  };

  function clearTimers() {
    for (const { timer, clear } of timers) {
      try { clear(timer); } catch (error) { recordCleanupFailure('worker timer', error); }
    }
    timers.clear();
  }

  function recordCleanupFailure(label, error) {
    const safeResourceLabel = safeLabel(label);
    cleanupErrors.push({ label: safeResourceLabel, code: safeErrorCode(error) });
    exitCode = 1;
    safeLog(`Email worker cleanup failed: ${safeResourceLabel} [${safeErrorCode(error)}]`);
  }

  function beginWorkerClose() {
    const worker = resources.worker;
    if (!worker || typeof worker.close !== 'function') return Promise.resolve();
    if (workerClosePromise) return workerClosePromise;

    try {
      // BullMQ 6.5.3 Worker.close() stops fetching new jobs and waits for active
      // work while closing the worker-owned Redis connections.
      workerClosePromise = Promise.resolve(worker.close()).catch((error) => {
        recordCleanupFailure('worker and its Redis connections', error);
      });
    } catch (error) {
      recordCleanupFailure('worker and its Redis connections', error);
      workerClosePromise = Promise.resolve();
    }
    return workerClosePromise;
  }

  async function closeOwnedResource(label, close) {
    if (typeof close !== 'function') return;
    try {
      await close();
    } catch (error) {
      recordCleanupFailure(label, error);
    }
  }

  async function waitForInFlightTasks() {
    while (inFlightTasks.size) {
      await Promise.allSettled([...inFlightTasks]);
    }
  }

  function callExit() {
    if (exitCalled) return;
    exitCalled = true;
    try {
      exit(exitCode);
    } catch (error) {
      safeLog(`Email worker exit callback failed [${safeErrorCode(error)}]`);
    }
  }

  const resources = { worker: null };

  function requestShutdown(reason, requestedExitCode = 0) {
    if (requestedExitCode !== 0) exitCode = 1;
    if (!shutdownRequested) {
      shutdownRequested = true;
      shutdownReason = reason;
      resolveShutdownRequested({ status: 'shutdown', reason });
      clearTimers();
      safeLog(`Email worker shutdown requested: ${safeLabel(reason)}`);
    }

    // Start this synchronously so BullMQ stops fetching before this signal
    // handler yields. Cleanup later awaits this same promise and never closes
    // the worker twice.
    beginWorkerClose();

    if (!shutdownPromise) {
      const stageToFinish = activeStage && activeStage.promise;
      shutdownPromise = (async () => {
        if (stageToFinish) {
          try { await stageToFinish; } catch (_) { /* Startup error is retained by the stage runner. */ }
        }
        clearTimers();
        await beginWorkerClose();
        await waitForInFlightTasks();
        await closeOwnedResource('BullMQ queue and its Redis connection', queueClose);
        for (const resource of redisClosers) {
          await closeOwnedResource(resource.label, resource.close);
        }
        // Disconnect after any connect attempt, including a rejected attempt:
        // Mongoose may still have a connection in transition. This does not
        // mark the connection as successfully established.
        if (mongoConnectAttempted) {
          await closeOwnedResource('MongoDB connection', mongoDisconnect);
        }
        callExit();
        return { exitCode, cleanupErrors: [...cleanupErrors], startupError };
      })().catch((error) => {
        recordCleanupFailure('lifecycle cleanup', error);
        callExit();
        return { exitCode, cleanupErrors: [...cleanupErrors], startupError };
      });
    }
    return shutdownPromise;
  }

  function fail(error, stage = 'runtime') {
    if (!startupError) startupError = error;
    exitCode = 1;
    safeLog(`Email worker ${stage} failed [${safeErrorCode(error)}]`);
    return requestShutdown(stage, 1);
  }

  function registerSignalHandlers() {
    const onSignal = (signal) => {
      void requestShutdown(signal, 0).catch((error) => {
        safeLog(`Email worker shutdown handler failed [${safeErrorCode(error)}]`);
      });
    };
    processObject.on('SIGTERM', () => onSignal('SIGTERM'));
    processObject.on('SIGINT', () => onSignal('SIGINT'));
    processObject.on('unhandledRejection', (error) => { void fail(error, 'unhandled-rejection'); });
    processObject.on('uncaughtException', (error) => { void fail(error, 'uncaught-exception'); });
  }

  const context = {
    get isShutdownRequested() { return shutdownRequested; },
    requestShutdown,
    fail,
    recordCleanupFailure,
    registerWorker(worker) {
      if (!worker || typeof worker.close !== 'function') {
        throw new TypeError('A closeable BullMQ worker is required');
      }
      if (resources.worker && resources.worker !== worker) {
        throw new Error('Only one email worker may be registered');
      }
      resources.worker = worker;
      if (shutdownRequested) beginWorkerClose();
      return worker;
    },
    registerQueue(queue) {
      if (!queue) return null;
      if (queueClose) throw new Error('Only one email queue may be registered');
      if (typeof queue.close !== 'function') throw new TypeError('A closeable BullMQ queue is required');
      queueClose = () => queue.close();
      return queue;
    },
    registerRedisCloser(label, close) {
      if (typeof close !== 'function') throw new TypeError('A Redis close function is required');
      redisClosers.push({ label: safeLabel(label), close });
    },
    markMongoConnectAttempted(disconnect) {
      if (typeof disconnect !== 'function') throw new TypeError('A MongoDB disconnect function is required');
      mongoConnectAttempted = true;
      mongoDisconnect = disconnect;
    },
    registerTimer(timer, clear = clearInterval) {
      if (timer === undefined || timer === null || typeof clear !== 'function') return;
      if (shutdownRequested) {
        try { clear(timer); } catch (error) { recordCleanupFailure('worker timer', error); }
        return;
      }
      timers.add({ timer, clear });
    },
    trackInFlightTask(task) {
      const tracked = Promise.resolve(task);
      inFlightTasks.add(tracked);
      // Mark the rejection as observed even if the original caller fails to
      // attach its own handler; cleanup still waits for settlement.
      tracked.then(
        () => inFlightTasks.delete(tracked),
        () => inFlightTasks.delete(tracked),
      );
      tracked.catch(() => {});
      return tracked;
    },
    waitForShutdownOr(promise) {
      if (shutdownRequested) return Promise.resolve({ status: 'shutdown', reason: shutdownReason });
      const observed = Promise.resolve(promise).then(
        value => ({ status: 'ready', value }),
        error => ({ status: 'error', error }),
      );
      return Promise.race([observed, shutdownRequestedPromise]).then((result) => {
        if (result.status === 'error') throw result.error;
        return result;
      });
    },
  };

  async function runStages(stages) {
    try {
      if (!Array.isArray(stages) || stages.some(stage => !stage || typeof stage.name !== 'string' || typeof stage.run !== 'function')) {
        throw new TypeError('Named email worker startup stages are required');
      }

      for (const stage of stages) {
        if (shutdownRequested) break;

        let resolveStage;
        let rejectStage;
        const rawStagePromise = new Promise((resolve, reject) => {
          resolveStage = resolve;
          rejectStage = reject;
        });
        const stagePromise = rawStagePromise.catch((error) => {
          if (!startupError) startupError = error;
          exitCode = 1;
          throw error;
        });
        activeStage = { name: stage.name, promise: stagePromise };

        if (shutdownRequested) {
          resolveStage();
        } else {
          try {
            Promise.resolve(stage.run(context)).then(resolveStage, rejectStage);
          } catch (error) {
            rejectStage(error);
          }
        }

        try {
          await stagePromise;
        } finally {
          if (activeStage && activeStage.promise === stagePromise) activeStage = null;
        }
      }

      if (shutdownRequested) {
        await shutdownPromise;
        return { status: 'shutdown', exitCode, startupError };
      }
      return { status: 'ready', exitCode: 0 };
    } catch (error) {
      if (!startupError) startupError = error;
      exitCode = 1;
      safeLog(`Email worker startup failed [${safeErrorCode(error)}]`);
      await requestShutdown('startup-failure', 1);
      throw startupError;
    }
  }

  function start(stages) {
    if (startPromise) throw new Error('Email worker lifecycle can only be started once');
    registerSignalHandlers();
    startPromise = runStages(stages);
    return startPromise;
  }

  return {
    context,
    start,
    requestShutdown,
    get shutdownRequested() { return shutdownRequested; },
    get startupError() { return startupError; },
    get cleanupErrors() { return [...cleanupErrors]; },
  };
}

module.exports = { createEmailWorkerLifecycle, safeErrorCode };
