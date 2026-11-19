'use strict';

function closeHttpServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function createGracefulShutdown({ closeHttp, closeRedis, disconnectMongo, exit, log = () => {} }) {
  if (![closeHttp, closeRedis, disconnectMongo, exit].every(step => typeof step === 'function')) {
    throw new TypeError('Shutdown cleanup functions are required');
  }

  let shutdownPromise;
  return function gracefulShutdown(reason, requestedExitCode = 0) {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      log(`Shutdown started: ${reason}`);
      let exitCode = requestedExitCode;
      const cleanupSteps = [
        ['HTTP', closeHttp],
        ['Redis', closeRedis],
        ['MongoDB', disconnectMongo],
      ];
      for (const [label, cleanup] of cleanupSteps) {
        try {
          await cleanup();
        } catch (_) {
          exitCode = 1;
          log(`Shutdown cleanup failed: ${label}`);
        }
      }
      exit(exitCode);
      return exitCode;
    })();

    return shutdownPromise;
  };
}

function registerShutdownSignalHandlers(processObject, gracefulShutdown) {
  if (!processObject || typeof processObject.on !== 'function' || typeof gracefulShutdown !== 'function') {
    throw new TypeError('Process object and shutdown handler are required');
  }
  processObject.on('SIGTERM', () => { void gracefulShutdown('SIGTERM', 0); });
  processObject.on('SIGINT', () => { void gracefulShutdown('SIGINT', 0); });
}

module.exports = {
  closeHttpServer,
  createGracefulShutdown,
  registerShutdownSignalHandlers,
};
