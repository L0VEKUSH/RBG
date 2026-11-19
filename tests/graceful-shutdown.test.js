'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  closeHttpServer,
  createGracefulShutdown,
  registerShutdownSignalHandlers,
} = require('../utils/graceful-shutdown');

function makeLifecycle(overrides = {}) {
  const calls = [];
  const exits = [];
  const shutdown = createGracefulShutdown({
    closeHttp: async () => calls.push('http'),
    closeRedis: async () => calls.push('redis'),
    disconnectMongo: async () => calls.push('mongo'),
    exit: code => exits.push(code),
    ...overrides,
  });
  return { calls, exits, shutdown };
}

test('SIGTERM performs ordered cleanup and exits only after all cleanup steps', async () => {
  const { calls, exits, shutdown } = makeLifecycle();
  const processMock = new EventEmitter();
  registerShutdownSignalHandlers(processMock, shutdown);
  processMock.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['http', 'redis', 'mongo']);
  assert.deepEqual(exits, [0]);
});

test('SIGINT uses the same ordered cleanup path', async () => {
  const { calls, exits, shutdown } = makeLifecycle();
  const processMock = new EventEmitter();
  registerShutdownSignalHandlers(processMock, shutdown);
  processMock.emit('SIGINT');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['http', 'redis', 'mongo']);
  assert.deepEqual(exits, [0]);
});

test('repeated signals share one guarded cleanup run', async () => {
  const { calls, exits, shutdown } = makeLifecycle();
  const processMock = new EventEmitter();
  registerShutdownSignalHandlers(processMock, shutdown);
  processMock.emit('SIGTERM');
  processMock.emit('SIGINT');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['http', 'redis', 'mongo']);
  assert.equal(exits.length, 1);
});

test('HTTP close failure does not skip Redis or MongoDB cleanup', async () => {
  const calls = [];
  const exits = [];
  const shutdown = createGracefulShutdown({
    closeHttp: async () => { calls.push('http'); throw new Error('HTTP_CLOSE_FAILED'); },
    closeRedis: async () => calls.push('redis'),
    disconnectMongo: async () => calls.push('mongo'),
    exit: code => exits.push(code),
  });
  await shutdown('test-signal', 0);
  assert.deepEqual(calls, ['http', 'redis', 'mongo']);
  assert.deepEqual(exits, [1]);
});

test('Redis close failure does not skip MongoDB disconnect', async () => {
  const calls = [];
  const exits = [];
  const shutdown = createGracefulShutdown({
    closeHttp: async () => calls.push('http'),
    closeRedis: async () => { calls.push('redis'); throw new Error('REDIS_CLOSE_FAILED'); },
    disconnectMongo: async () => calls.push('mongo'),
    exit: code => exits.push(code),
  });
  await shutdown('test-signal', 0);
  assert.deepEqual(calls, ['http', 'redis', 'mongo']);
  assert.deepEqual(exits, [1]);
});

test('MongoDB disconnect failure is reported after earlier cleanup and changes exit status', async () => {
  const calls = [];
  const exits = [];
  const shutdown = createGracefulShutdown({
    closeHttp: async () => calls.push('http'),
    closeRedis: async () => calls.push('redis'),
    disconnectMongo: async () => { calls.push('mongo'); throw new Error('MONGO_DISCONNECT_FAILED'); },
    exit: code => exits.push(code),
  });
  await shutdown('test-signal', 0);
  assert.deepEqual(calls, ['http', 'redis', 'mongo']);
  assert.deepEqual(exits, [1]);
});

test('shutdown completion waits for every cleanup attempt before exit', async () => {
  const calls = [];
  const exits = [];
  let finishHttp;
  const httpPending = new Promise(resolve => { finishHttp = resolve; });
  const shutdown = createGracefulShutdown({
    closeHttp: async () => { calls.push('http-start'); await httpPending; calls.push('http-finish'); },
    closeRedis: async () => calls.push('redis'),
    disconnectMongo: async () => calls.push('mongo'),
    exit: code => exits.push(code),
  });
  const pending = shutdown('test-signal', 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['http-start']);
  assert.deepEqual(exits, []);
  finishHttp();
  await pending;
  assert.deepEqual(calls, ['http-start', 'http-finish', 'redis', 'mongo']);
  assert.deepEqual(exits, [0]);
});

test('HTTP server closure awaits its close callback and propagates callback errors', async () => {
  const listeningServer = {
    listening: true,
    close(callback) { setImmediate(() => callback(new Error('CLOSE_CALLBACK_FAILED'))); },
  };
  await assert.rejects(closeHttpServer(listeningServer), /CLOSE_CALLBACK_FAILED/);
  await assert.rejects(
    closeHttpServer({ listening: false, close(callback) { callback(new Error('NOT_LISTENING')); } }),
    /NOT_LISTENING/
  );
  await closeHttpServer(null);
});
