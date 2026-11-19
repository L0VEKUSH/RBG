const assert = require('assert');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { createClient } = require('redis');

const redisUrl = process.env.REDIS_TEST_URL;
assert(redisUrl, 'REDIS_TEST_URL is required; refusing to use an implicit Redis server');
const parsed = new URL(redisUrl);
assert(['localhost', '127.0.0.1', '::1'].includes(parsed.hostname),
  'Redis integration tests only permit localhost');
assert(process.env.NODE_ENV === 'test', 'NODE_ENV=test is required');

const prefix = `erp-rate-test-${process.pid}-${Date.now()}:`;
const clients = [];
const servers = [];
const erpTestIp = `10.254.${process.pid % 200}.${Date.now() % 200}`;

function createInstance(client) {
  const app = express();
  app.set('trust proxy', 0);
  app.use(rateLimit({
    windowMs: 60_000,
    max: 3,
    keyGenerator: (req) => req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      prefix,
      sendCommand: (...command) => client.sendCommand(command),
    }),
    handler: (req, res) => res.status(429).json({ message: 'Too many requests' }),
  }));
  app.get('/limited', (req, res) => res.json({ ok: true }));
  return app;
}

async function request(port) {
  const response = await fetch(`http://127.0.0.1:${port}/limited`);
  return response.status;
}

async function testErpAuthRoutes() {
  process.env.REDIS_URL = redisUrl;
  process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '3';
  const authRouter = require('../routes/auth.routes');
  const apps = [express(), express()].map((app) => {
    app.set('trust proxy', 1);
    app.use('/api/v1/auth', authRouter);
    return app.listen(0);
  });
  try {
    const statuses = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await fetch(
        `http://127.0.0.1:${apps[index % 2].address().port}/api/v1/auth/login`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': erpTestIp,
          },
          body: JSON.stringify({ email: 'invalid', password: 'invalid' }),
        }
      );
      statuses.push(response.status);
    }
    assert.deepStrictEqual(statuses, [400, 400, 400, 429],
      'ERP login route must share its Redis counter across instances');
  } finally {
    await Promise.all(apps.map((server) => new Promise((resolve) => server.close(resolve))));
    await clients[0].del(`erp-auth-login:${erpTestIp}`);
  }
}

async function main() {
  for (let index = 0; index < 2; index += 1) {
    const client = createClient({ url: redisUrl });
    await client.connect();
    clients.push(client);
  }

  servers.push(createInstance(clients[0]).listen(0));
  servers.push(createInstance(clients[1]).listen(0));
  const ports = servers.map((server) => server.address().port);
  const statuses = [];
  for (let index = 0; index < 4; index += 1) {
    statuses.push(await request(ports[index % 2]));
  }
  assert.deepStrictEqual(statuses, [200, 200, 200, 429],
    'Two application instances must share the same Redis limit');

  await new Promise((resolve) => servers[0].close(resolve));
  servers[0] = createInstance(clients[0]).listen(0);
  assert.strictEqual(await request(servers[0].address().port), 429,
    'Restarting an instance must not reset the shared Redis counter');

  await testErpAuthRoutes();
  console.log('Redis multi-instance rate-limit test passed');
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(resolve);
    })));
    await Promise.all(clients.map((client) => client.quit().catch(() => {})));
    const { closeRedis } = require('../config/redis');
    await closeRedis().catch(() => {});
  });
