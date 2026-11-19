'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createEmailWorkerLifecycle } = require('../utils/email-worker-lifecycle');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness({ processObject = new EventEmitter(), log } = {}) {
  const events = [];
  const exits = [];
  const logs = [];
  const lifecycle = createEmailWorkerLifecycle({
    processObject,
    exit: code => { exits.push(code); events.push(`exit:${code}`); },
    log: message => { logs.push(message); if (log) log(message); },
  });
  return { events, exits, logs, lifecycle, processObject };
}

function ownMongo(context, events, disconnectError) {
  context.markMongoConnectAttempted(async () => {
    events.push('mongo.disconnect');
    if (disconnectError) throw disconnectError;
  });
}

function ownQueue(context, events, closeError) {
  context.registerQueue({
    async close() {
      events.push('queue.close');
      if (closeError) throw closeError;
    },
  });
}

function ownWorker(context, events, { closeError, onClose } = {}) {
  const worker = {
    acceptingJobs: false,
    closeCalls: 0,
    close() {
      this.closeCalls += 1;
      this.acceptingJobs = false;
      events.push('worker.close');
      if (onClose) onClose();
      if (closeError) return Promise.reject(closeError);
      return Promise.resolve();
    },
    run() {
      this.acceptingJobs = true;
      events.push('worker.run');
      return new Promise(() => {});
    },
  };
  context.registerWorker(worker);
  return worker;
}

test('SIGTERM installed before startup can prevent the database connection stage', async () => {
  class EarlySignalProcess extends EventEmitter {
    on(eventName, listener) {
      super.on(eventName, listener);
      if (eventName === 'SIGTERM' && !this.sentEarlySignal) {
        this.sentEarlySignal = true;
        this.emit('SIGTERM');
      }
      return this;
    }
  }
  const processObject = new EarlySignalProcess();
  const { events, exits, lifecycle } = harness({ processObject });
  const result = await lifecycle.start([
    { name: 'email validation', run: () => events.push('validate') },
    { name: 'database connection', run: () => events.push('mongo.connect') },
  ]);
  assert.equal(result.status, 'shutdown');
  assert.deepEqual(events, ['exit:0']);
  assert.deepEqual(exits, [0]);
});

test('SIGINT during database readiness finishes the active check and skips later stages', async () => {
  const { events, exits, lifecycle, processObject } = harness();
  const gate = deferred();
  const start = lifecycle.start([
    { name: 'connect', run: context => { events.push('mongo.connect'); ownMongo(context, events); } },
    { name: 'readiness', run: async () => {
      events.push('readiness.start');
      processObject.emit('SIGINT');
      await gate.promise;
      events.push('readiness.finish');
    } },
    { name: 'recovery', run: () => events.push('recovery') },
  ]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['mongo.connect', 'readiness.start']);
  gate.resolve();
  const result = await start;
  assert.equal(result.status, 'shutdown');
  assert.deepEqual(events, ['mongo.connect', 'readiness.start', 'readiness.finish', 'mongo.disconnect', 'exit:0']);
  assert.deepEqual(exits, [0]);
});

test('signal during saga recovery prevents reconciliation and consumer construction', async () => {
  const { events, lifecycle, processObject } = harness();
  const gate = deferred();
  const start = lifecycle.start([
    { name: 'recovery', run: async () => {
      events.push('recovery.start');
      processObject.emit('SIGTERM');
      await gate.promise;
      events.push('recovery.finish');
    } },
    { name: 'reconciliation', run: () => events.push('reconciliation') },
    { name: 'consumer construction', run: () => events.push('consumer.construct') },
  ]);
  await new Promise(resolve => setImmediate(resolve));
  gate.resolve();
  await start;
  assert.deepEqual(events, ['recovery.start', 'recovery.finish', 'exit:0']);
});

test('signal during delivery reconciliation finishes it without constructing a consumer', async () => {
  const { events, lifecycle, processObject } = harness();
  const gate = deferred();
  const start = lifecycle.start([
    { name: 'delivery reconciliation', run: async () => {
      events.push('reconciliation.start');
      processObject.emit('SIGINT');
      await gate.promise;
      events.push('reconciliation.finish');
    } },
    { name: 'consumer construction', run: () => events.push('consumer.construct') },
  ]);
  await new Promise(resolve => setImmediate(resolve));
  gate.resolve();
  await start;
  assert.deepEqual(events, ['reconciliation.start', 'reconciliation.finish', 'exit:0']);
});

test('signal during worker construction closes the registered idle worker and skips intake', async () => {
  const { events, lifecycle, processObject } = harness();
  let worker;
  const result = await lifecycle.start([
    { name: 'construct consumer', run: context => {
      processObject.emit('SIGTERM');
      worker = ownWorker(context, events);
    } },
    { name: 'wait ready', run: () => events.push('wait-ready') },
    { name: 'start consumer', run: () => worker.run() },
  ]);
  assert.equal(result.status, 'shutdown');
  assert.equal(worker.closeCalls, 1);
  assert.equal(worker.acceptingJobs, false);
  assert.deepEqual(events, ['worker.close', 'exit:0']);
});

test('signal during consumer readiness closes it and prevents new jobs', async () => {
  const { events, lifecycle, processObject } = harness();
  const ready = deferred();
  let worker;
  const start = lifecycle.start([
    { name: 'construct consumer', run: context => { worker = ownWorker(context, events); } },
    { name: 'consumer readiness', run: async context => {
      const result = await context.waitForShutdownOr(ready.promise);
      if (result.status === 'ready') events.push('ready');
    } },
    { name: 'start consumer', run: () => worker.run() },
  ]);
  await new Promise(resolve => setImmediate(resolve));
  processObject.emit('SIGTERM');
  await start;
  ready.reject(new Error('late readiness rejection'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.acceptingJobs, false);
  assert.deepEqual(events, ['worker.close', 'exit:0']);
});

test('a running consumer stops accepting new jobs as soon as shutdown begins', async () => {
  const { events, lifecycle, processObject } = harness();
  let worker;
  await lifecycle.start([
    { name: 'construct consumer', run: context => { worker = ownWorker(context, events); } },
    { name: 'start consumer', run: () => { void worker.run().catch(() => {}); } },
  ]);
  assert.equal(worker.acceptingJobs, true);
  processObject.emit('SIGTERM');
  assert.equal(worker.acceptingJobs, false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['worker.run', 'worker.close', 'exit:0']);
});

test('shutdown drains an in-flight reconciliation before closing its queue and database', async () => {
  const { events, lifecycle, processObject } = harness();
  const gate = deferred();
  await lifecycle.start([{ name: 'own resources and maintenance task', run: context => {
    ownMongo(context, events);
    ownQueue(context, events);
    ownWorker(context, events);
    const maintenance = (async () => {
      events.push('recovery.start');
      await gate.promise;
      events.push('recovery.finish');
      if (!context.isShutdownRequested) events.push('reconciliation');
    })();
    context.trackInFlightTask(maintenance);
  } }]);
  processObject.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['recovery.start', 'worker.close']);
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [
    'recovery.start', 'worker.close', 'recovery.finish', 'queue.close', 'mongo.disconnect', 'exit:0',
  ]);
});

test('normal shutdown closes worker, queue, then MongoDB and exits after cleanup', async () => {
  const { events, exits, lifecycle, processObject } = harness();
  let worker;
  const result = await lifecycle.start([
    { name: 'own resources', run: context => {
      ownMongo(context, events);
      ownQueue(context, events);
      worker = ownWorker(context, events);
    } },
  ]);
  assert.equal(result.status, 'ready');
  processObject.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.closeCalls, 1);
  assert.deepEqual(events, ['worker.close', 'queue.close', 'mongo.disconnect', 'exit:0']);
  assert.deepEqual(exits, [0]);
});

test('repeated signals share one cleanup run and close the worker only once', async () => {
  const { events, lifecycle, processObject } = harness();
  let worker;
  await lifecycle.start([{ name: 'own resources', run: context => {
    ownMongo(context, events);
    ownQueue(context, events);
    worker = ownWorker(context, events);
  } }]);
  processObject.emit('SIGTERM');
  processObject.emit('SIGINT');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.closeCalls, 1);
  assert.deepEqual(events, ['worker.close', 'queue.close', 'mongo.disconnect', 'exit:0']);
});

test('worker close failure is recorded and does not skip queue or MongoDB cleanup', async () => {
  const { events, exits, lifecycle, processObject } = harness();
  await lifecycle.start([{ name: 'own resources', run: context => {
    ownMongo(context, events);
    ownQueue(context, events);
    ownWorker(context, events, { closeError: new Error('synthetic close failure') });
  } }]);
  processObject.emit('SIGINT');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['worker.close', 'queue.close', 'mongo.disconnect', 'exit:1']);
  assert.deepEqual(exits, [1]);
  assert.ok(lifecycle.cleanupErrors.some(error => error.label === 'worker and its Redis connections'));
});

test('queue close failure does not skip MongoDB disconnect', async () => {
  const { events, exits, lifecycle, processObject } = harness();
  await lifecycle.start([{ name: 'own resources', run: context => {
    ownMongo(context, events);
    ownQueue(context, events, new Error('synthetic queue close failure'));
  } }]);
  processObject.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['queue.close', 'mongo.disconnect', 'exit:1']);
  assert.deepEqual(exits, [1]);
});

test('independent Redis close failure does not skip MongoDB disconnect', async () => {
  const { events, exits, lifecycle, processObject } = harness();
  await lifecycle.start([{ name: 'own resources', run: context => {
    ownMongo(context, events);
    context.registerRedisCloser('dedicated Redis', async () => {
      events.push('redis.close');
      throw new Error('synthetic Redis close failure');
    });
  } }]);
  processObject.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['redis.close', 'mongo.disconnect', 'exit:1']);
  assert.deepEqual(exits, [1]);
});

test('BullMQ Redis close error events are recorded while queue and MongoDB still close', async () => {
  const { events, exits, lifecycle, processObject } = harness();
  let worker;
  await lifecycle.start([{ name: 'own resources', run: context => {
    ownMongo(context, events);
    ownQueue(context, events);
    worker = ownWorker(context, events, {
      onClose() {
        context.recordCleanupFailure('worker Redis connection', new Error('synthetic Redis close failure'));
      },
    });
  } }]);
  processObject.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.closeCalls, 1);
  assert.deepEqual(events, ['worker.close', 'queue.close', 'mongo.disconnect', 'exit:1']);
  assert.deepEqual(exits, [1]);
});

test('MongoDB disconnect failure is recorded and exits nonzero', async () => {
  const { events, exits, lifecycle, processObject } = harness();
  await lifecycle.start([{ name: 'own resources', run: context => ownMongo(
    context, events, new Error('synthetic mongo disconnect failure')
  ) }]);
  processObject.emit('SIGINT');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['mongo.disconnect', 'exit:1']);
  assert.deepEqual(exits, [1]);
});

test('startup failure cleans initialized resources and preserves the original error', async () => {
  const { events, exits, lifecycle } = harness();
  const original = new Error('synthetic startup failure');
  await assert.rejects(lifecycle.start([
    { name: 'connect', run: context => ownMongo(context, events) },
    { name: 'initialize queue', run: context => ownQueue(context, events) },
    { name: 'recovery', run: () => { events.push('recovery'); throw original; } },
    { name: 'consumer construction', run: () => events.push('consumer.construct') },
  ]), error => error === original);
  assert.deepEqual(events, ['recovery', 'queue.close', 'mongo.disconnect', 'exit:1']);
  assert.deepEqual(exits, [1]);
  assert.equal(lifecycle.startupError, original);
});

test('startup error remains original when cleanup also fails and logs do not expose messages', async () => {
  const { events, exits, lifecycle, logs } = harness();
  const original = new Error('synthetic original startup failure');
  const privateDetail = 'synthetic-private-cleanup-detail';
  await assert.rejects(lifecycle.start([
    { name: 'connect', run: context => ownMongo(context, events) },
    { name: 'initialize queue', run: context => ownQueue(context, events, Object.assign(
      new Error(privateDetail), { code: 'QUEUE_CLEANUP_FAILED' }
    )) },
    { name: 'recovery', run: () => { throw original; } },
  ]), error => error === original);
  assert.deepEqual(events, ['queue.close', 'mongo.disconnect', 'exit:1']);
  assert.deepEqual(exits, [1]);
  assert.equal(logs.some(message => message.includes(privateDetail)), false);
  assert.ok(logs.some(message => message.includes('QUEUE_CLEANUP_FAILED')));
});

test('timers registered during or after shutdown are cleared and are not retained', async () => {
  const { events, lifecycle, processObject } = harness();
  let timerClears = 0;
  await lifecycle.start([{ name: 'timers', run: context => {
    const timer = {};
    context.registerTimer(timer, () => { timerClears += 1; });
  } }]);
  processObject.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timerClears, 1);
  assert.deepEqual(events, ['exit:0']);
});
