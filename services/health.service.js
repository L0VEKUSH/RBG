'use strict';
/**
 * health.service.js — Production Health, Readiness and Dependency Observability
 *
 * Implements bounded, non-destructive health probing for:
 * - Application process liveness (independent of dependency availability)
 * - Service readiness (database, Redis, startup gates, shutdown states)
 * - Independent dependency reporting (MongoDB, Redis, worker)
 * - Safe data sanitization (zero secrets, credentials, addresses, or stack traces)
 * - Explicit unknown worker status (avoids speculative cross-process health claims)
 */

const mongoose = require('mongoose');
const { sendRedisCommand, hasRedis } = require('../config/redis');

let _shutdownRequested = false;
let _startupReady = process.env.NODE_ENV !== 'production';

function setShutdownRequested(val = true) {
  _shutdownRequested = Boolean(val);
}

function setStartupReady(val = true) {
  _startupReady = Boolean(val);
}

function getSystemState() {
  return {
    shutdownRequested: _shutdownRequested,
    startupReady: _startupReady,
  };
}

function resetHealthState() {
  _shutdownRequested = false;
  _startupReady = process.env.NODE_ENV !== 'production';
}

/**
 * Bounded, non-destructive check of MongoDB connection.
 */
async function checkDatabase({ timeoutMs = 1000, mongooseInstance = mongoose } = {}) {
  const readyState = mongooseInstance?.connection?.readyState ?? 0;
  if (readyState !== 1) {
    const states = { 0: 'disconnected', 2: 'connecting', 3: 'disconnecting' };
    return {
      status: states[readyState] || 'disconnected',
      readyState,
    };
  }

  try {
    const db = mongooseInstance.connection.db;
    if (db && typeof db.command === 'function') {
      const pingPromise = Promise.resolve().then(() => db.command({ ping: 1 }));
      let timerId;
      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
        if (timerId && timerId.unref) timerId.unref();
      });
      try {
        await Promise.race([pingPromise, timeoutPromise]);
      } finally {
        clearTimeout(timerId);
      }
    }
    return { status: 'connected', readyState: 1 };
  } catch (error) {
    if (error && error.message === 'TIMEOUT') {
      return { status: 'timeout', readyState: 1 };
    }
    return { status: 'disconnected', readyState: 1 };
  }
}

/**
 * Bounded, non-destructive check of Redis connection.
 */
async function checkRedis({
  timeoutMs = 1000,
  sendCommand = sendRedisCommand,
  hasRedisConfigured = hasRedis,
} = {}) {
  if (!hasRedisConfigured) {
    return { status: 'disabled', configured: false };
  }

  try {
    const pingPromise = Promise.resolve().then(() => sendCommand('PING'));
    let timerId;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
      if (timerId && timerId.unref) timerId.unref();
    });
    let result;
    try {
      result = await Promise.race([pingPromise, timeoutPromise]);
    } finally {
      clearTimeout(timerId);
    }
    if (
      result === 'PONG' ||
      result === 'pong' ||
      result === true ||
      (typeof result === 'string' && result.toUpperCase() === 'PONG')
    ) {
      return { status: 'connected', configured: true };
    }
    return { status: 'disconnected', configured: true };
  } catch (error) {
    if (error && error.message === 'TIMEOUT') {
      return { status: 'timeout', configured: true };
    }
    return { status: 'disconnected', configured: true };
  }
}

/**
 * Email worker status determination.
 * As established by the architectural audit, the email worker runs as an independent
 * background process. Without a shared cross-process heartbeat or lease signal,
 * worker status is reported as unknown to avoid speculative claims.
 */
function checkWorker() {
  return {
    status: 'unknown',
  };
}

/**
 * Liveness determination: confirms the Node.js application process is running.
 * Must NOT fail when MongoDB or Redis is temporarily unavailable.
 * Remains available during graceful shutdown (status: 'terminating').
 */
function getLiveness({ isShuttingDown = _shutdownRequested } = {}) {
  return {
    statusCode: 200,
    payload: {
      status: isShuttingDown ? 'terminating' : 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Readiness determination: confirms the service can safely accept incoming traffic.
 */
async function getReadiness(options = {}) {
  const {
    mongooseInstance = mongoose,
    redisChecker = module.exports.checkRedis || checkRedis,
    dbChecker = module.exports.checkDatabase || checkDatabase,
    workerChecker = module.exports.checkWorker || checkWorker,
    isProduction = process.env.NODE_ENV === 'production',
    productionStartupReady = _startupReady,
    isShuttingDown = _shutdownRequested,
    timeoutMs = 1000,
  } = options;
  if (isShuttingDown) {
    return {
      isReady: false,
      statusCode: 503,
      payload: {
        status: 'degraded',
        message: 'Service is shutting down',
        db: 'disconnected',
        redis: 'disconnected',
        worker: 'unknown',
        checks: {
          database: { status: 'disconnected' },
          redis: { status: 'disconnected' },
          worker: { status: 'unknown' },
        },
      },
    };
  }

  if (isProduction && !productionStartupReady) {
    return {
      isReady: false,
      statusCode: 503,
      payload: {
        status: 'degraded',
        message: 'The service is completing its startup checks. Please retry shortly.',
        db: 'disconnected',
        redis: 'disconnected',
        worker: 'unknown',
        checks: {
          database: { status: 'disconnected' },
          redis: { status: 'disconnected' },
          worker: { status: 'unknown' },
        },
      },
    };
  }

  const [dbResult, redisResult] = await Promise.all([
    Promise.resolve()
      .then(() => dbChecker({ timeoutMs, mongooseInstance }))
      .catch(() => ({ status: 'disconnected' })),
    Promise.resolve()
      .then(() => redisChecker({ timeoutMs }))
      .catch(() => ({ status: 'disconnected' })),
  ]);

  const workerResult = workerChecker();

  const isDbReady = dbResult.status === 'connected';
  const isRedisReady =
    redisResult.status === 'connected' ||
    (!isProduction && redisResult.status === 'disabled');

  const isReady = isDbReady && isRedisReady;

  return {
    isReady,
    statusCode: isReady ? 200 : 503,
    payload: {
      status: isReady ? 'ok' : 'degraded',
      db: dbResult.status,
      redis: redisResult.status,
      worker: workerResult.status,
      checks: {
        database: { status: dbResult.status },
        redis: { status: redisResult.status },
        worker: { status: workerResult.status },
      },
    },
  };
}

module.exports = {
  checkDatabase,
  checkRedis,
  checkWorker,
  getLiveness,
  getReadiness,
  setShutdownRequested,
  setStartupReady,
  getSystemState,
  resetHealthState,
};
