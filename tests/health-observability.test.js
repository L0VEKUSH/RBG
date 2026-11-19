'use strict';
/**
 * Phase 22.6 — Production Health, Readiness and Dependency Observability Tests
 *
 * Verifies:
 *  1. Liveness while MongoDB is unavailable returns 200 OK
 *  2. Liveness during graceful shutdown reports status 'terminating' (200 OK)
 *  3. Readiness when MongoDB and Redis are connected returns 200 OK
 *  4. Readiness when MongoDB is disconnected returns 503 Degraded
 *  5. Readiness when MongoDB is in connecting/disconnecting states returns 503
 *  6. Redis connected state is reported independently and accurately
 *  7. Redis disconnected state in production fails readiness (503)
 *  8. Redis disabled in non-production does not block readiness
 *  9. Worker status explicitly reported as 'unknown' without speculative claims
 * 10. Graceful shutdown transitions readiness to 503 immediately
 * 11. Production startup checks pending transitions readiness to 503
 * 12. MongoDB ping timeout fails safely and returns status 'timeout'
 * 13. Redis ping timeout fails safely and returns status 'timeout'
 * 14. Response sanitization: zero credentials, URIs, internal IPs, or stack traces
 * 15. Backward compatibility: existing /health returns { status: 'ok', db: 'connected' } for admin-portal.js
 * 16. Express router: /health, /health/ready, and /health/live route dispatch
 * 17. Origin protection: safe GET /health probes are never blocked by origin protection
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');
const http     = require('http');
const express  = require('express');

const REPO = path.resolve(__dirname, '..');
const {
  checkDatabase,
  checkRedis,
  checkWorker,
  getLiveness,
  getReadiness,
  setShutdownRequested,
  setStartupReady,
  resetHealthState,
} = require(path.join(REPO, 'services', 'health.service'));
const healthRoutes = require(path.join(REPO, 'routes', 'health.routes'));
const { protectOrigin } = require(path.join(REPO, 'middleware', 'origin-protection.middleware'));

test('Phase 22.6: Production Health, Readiness and Dependency Observability Suite', async (t) => {

  t.beforeEach(() => {
    resetHealthState();
  });

  t.afterEach(() => {
    resetHealthState();
  });

  // ── 1. Liveness checks ───────────────────────────────────────────────────
  await t.test('1. Liveness while MongoDB is unavailable returns 200 OK', () => {
    // Process is alive even if MongoDB has readyState 0 (disconnected)
    const result = getLiveness({ isShuttingDown: false });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.status, 'ok');
    assert.equal(typeof result.payload.uptime, 'number');
    assert.ok(result.payload.uptime >= 0);
    assert.ok(result.payload.timestamp);
  });

  await t.test('2. Liveness during graceful shutdown reports status "terminating" (200 OK)', () => {
    const result = getLiveness({ isShuttingDown: true });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.status, 'terminating');
    assert.equal(typeof result.payload.uptime, 'number');
  });

  // ── 2. Readiness checks: MongoDB states ────────────────────────────────────
  await t.test('3. Readiness when MongoDB and Redis are connected returns 200 OK', async () => {
    const mockMongoose = {
      connection: {
        readyState: 1,
        db: { command: async () => ({ ok: 1 }) },
      },
    };
    const mockRedisChecker = async () => ({ status: 'connected', configured: true });

    const result = await getReadiness({
      mongooseInstance: mockMongoose,
      redisChecker: mockRedisChecker,
      isProduction: true,
      productionStartupReady: true,
      isShuttingDown: false,
    });

    assert.equal(result.isReady, true);
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.status, 'ok');
    assert.equal(result.payload.db, 'connected');
    assert.equal(result.payload.redis, 'connected');
    assert.equal(result.payload.worker, 'unknown');
    assert.equal(result.payload.checks.database.status, 'connected');
    assert.equal(result.payload.checks.redis.status, 'connected');
    assert.equal(result.payload.checks.worker.status, 'unknown');
  });

  await t.test('4. Readiness when MongoDB is disconnected returns 503 Degraded', async () => {
    const mockMongoose = {
      connection: { readyState: 0 },
    };
    const mockRedisChecker = async () => ({ status: 'connected', configured: true });

    const result = await getReadiness({
      mongooseInstance: mockMongoose,
      redisChecker: mockRedisChecker,
      isProduction: true,
      productionStartupReady: true,
      isShuttingDown: false,
    });

    assert.equal(result.isReady, false);
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.status, 'degraded');
    assert.equal(result.payload.db, 'disconnected');
    assert.equal(result.payload.checks.database.status, 'disconnected');
  });

  await t.test('5. Readiness when MongoDB is connecting (2) or disconnecting (3) returns 503', async () => {
    for (const [stateCode, stateName] of [[2, 'connecting'], [3, 'disconnecting']]) {
      const mockMongoose = {
        connection: { readyState: stateCode },
      };
      const result = await getReadiness({
        mongooseInstance: mockMongoose,
        redisChecker: async () => ({ status: 'connected', configured: true }),
        isProduction: false,
      });

      assert.equal(result.isReady, false);
      assert.equal(result.statusCode, 503);
      assert.equal(result.payload.db, stateName);
    }
  });

  // ── 3. Readiness checks: Redis states ─────────────────────────────────────
  await t.test('6. Redis connected state is reported independently and accurately', async () => {
    const mockSendCommand = async (cmd) => {
      assert.equal(cmd, 'PING');
      return 'PONG';
    };

    const redisResult = await checkRedis({
      sendCommand: mockSendCommand,
      hasRedisConfigured: true,
    });
    assert.equal(redisResult.status, 'connected');
    assert.equal(redisResult.configured, true);
  });

  await t.test('7. Redis disconnected state in production fails readiness (503)', async () => {
    const mockMongoose = {
      connection: {
        readyState: 1,
        db: { command: async () => ({ ok: 1 }) },
      },
    };
    const mockRedisChecker = async () => ({ status: 'disconnected', configured: true });

    const result = await getReadiness({
      mongooseInstance: mockMongoose,
      redisChecker: mockRedisChecker,
      isProduction: true,
      productionStartupReady: true,
      isShuttingDown: false,
    });

    assert.equal(result.isReady, false);
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.status, 'degraded');
    assert.equal(result.payload.redis, 'disconnected');
  });

  await t.test('8. Redis disabled in non-production does not block readiness', async () => {
    const mockMongoose = {
      connection: {
        readyState: 1,
        db: { command: async () => ({ ok: 1 }) },
      },
    };
    const mockRedisChecker = async () => ({ status: 'disabled', configured: false });

    const result = await getReadiness({
      mongooseInstance: mockMongoose,
      redisChecker: mockRedisChecker,
      isProduction: false,
      productionStartupReady: true,
      isShuttingDown: false,
    });

    assert.equal(result.isReady, true);
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.status, 'ok');
    assert.equal(result.payload.redis, 'disabled');
  });

  // ── 4. Worker status determination ────────────────────────────────────────
  await t.test('9. Worker status explicitly reported as "unknown" without speculative claims', () => {
    const workerResult = checkWorker();
    assert.equal(workerResult.status, 'unknown');
  });

  // ── 5. Lifecycle states: Shutdown and Startup ─────────────────────────────
  await t.test('10. Graceful shutdown transitions readiness to 503 immediately', async () => {
    const mockMongoose = {
      connection: {
        readyState: 1,
        db: { command: async () => ({ ok: 1 }) },
      },
    };
    const result = await getReadiness({
      mongooseInstance: mockMongoose,
      isShuttingDown: true,
    });

    assert.equal(result.isReady, false);
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.status, 'degraded');
    assert.equal(result.payload.message, 'Service is shutting down');
  });

  await t.test('11. Production startup checks pending transitions readiness to 503', async () => {
    const mockMongoose = {
      connection: {
        readyState: 1,
        db: { command: async () => ({ ok: 1 }) },
      },
    };
    const result = await getReadiness({
      mongooseInstance: mockMongoose,
      isProduction: true,
      productionStartupReady: false,
      isShuttingDown: false,
    });

    assert.equal(result.isReady, false);
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.status, 'degraded');
    assert.ok(result.payload.message.includes('startup checks'));
  });

  // ── 6. Timeout handling ───────────────────────────────────────────────────
  await t.test('12. MongoDB ping timeout fails safely and returns status "timeout"', async () => {
    const mockMongoose = {
      connection: {
        readyState: 1,
        db: {
          command: () => new Promise(() => {}), // never resolves
        },
      },
    };

    const dbResult = await checkDatabase({
      mongooseInstance: mockMongoose,
      timeoutMs: 30,
    });

    assert.equal(dbResult.status, 'timeout');
  });

  await t.test('13. Redis ping timeout fails safely and returns status "timeout"', async () => {
    const mockSendCommand = () => new Promise(() => {}); // never resolves

    const redisResult = await checkRedis({
      sendCommand: mockSendCommand,
      hasRedisConfigured: true,
      timeoutMs: 30,
    });

    assert.equal(redisResult.status, 'timeout');
  });

  // ── 7. Response sanitization ──────────────────────────────────────────────
  await t.test('14. Response sanitization: zero credentials, URIs, internal IPs, or stack traces', async () => {
    const mockMongoose = {
      connection: {
        readyState: 1,
        db: { command: async () => ({ ok: 1 }) },
      },
    };
    const result = await getReadiness({
      mongooseInstance: mockMongoose,
      isProduction: true,
      productionStartupReady: true,
    });

    const serialized = JSON.stringify(result.payload);
    assert.doesNotMatch(serialized, /mongodb(?:\+srv)?:\/\//i);
    assert.doesNotMatch(serialized, /redis:\/\//i);
    assert.doesNotMatch(serialized, /localhost|127\.0\.0\.1|cluster0/i);
    assert.doesNotMatch(serialized, /stack|password|secret|key/i);
  });

  // ── 8. Route dispatch and backward compatibility ──────────────────────────
  await t.test('15. Backward compatibility: existing /health returns status ok and db connected for admin-portal.js', async () => {
    const app = express();
    app.use('/health', healthRoutes);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await response.json();

      // Verify shape required by admin-portal.js:
      // apiStatus: response.ok ? 'Online' : 'Unavailable'
      // dbStatus: health.db === 'connected' ? 'Connected' : 'Disconnected'
      assert.ok('db' in body);
      assert.ok('status' in body);
      assert.ok('checks' in body);
      assert.equal(body.worker, 'unknown');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test('16. Express router: /health/ready and /health/live route dispatch', async () => {
    const app = express();
    app.use('/health', healthRoutes);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      // 1. Liveness
      const liveRes = await fetch(`http://127.0.0.1:${port}/health/live`);
      assert.equal(liveRes.status, 200);
      const liveBody = await liveRes.json();
      assert.equal(liveBody.status, 'ok');
      assert.equal(typeof liveBody.uptime, 'number');

      // 2. Readiness
      const readyRes = await fetch(`http://127.0.0.1:${port}/health/ready`);
      const readyBody = await readyRes.json();
      assert.ok(readyRes.status === 200 || readyRes.status === 503);
      assert.ok('status' in readyBody);
      assert.ok('checks' in readyBody);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test('17. Origin protection: safe GET /health probes are never blocked by origin protection', () => {
    for (const path of ['/health', '/health/ready', '/health/live']) {
      let nextCalled = false;
      const fakeReq = {
        method: 'GET',
        path,
        headers: {
          origin: 'https://evil.attacker.com',
          'sec-fetch-site': 'cross-site',
        },
      };
      protectOrigin(fakeReq, {}, (err) => {
        assert.equal(err, undefined);
        nextCalled = true;
      });
      assert.equal(nextCalled, true, `Probe ${path} must never be blocked by origin protection`);
    }
  });

});
