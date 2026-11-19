const assert = require('assert');

process.env.NODE_ENV = 'test';
process.env.REDIS_URL = 'redis://:synthetic-secret@127.0.0.1:6399';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '3';

const express = require('express');
const http = require('http');
const authRouter = require('../routes/auth.routes');
const { closeRedis } = require('../config/redis');
let expectedOutage = true;

process.on('uncaughtException', (error) => {
  if (expectedOutage && error && error.message.includes('Redis rate-limit store unavailable')) return;
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
process.on('unhandledRejection', (error) => {
  if (expectedOutage && error && error.message.includes('Redis rate-limit store unavailable')) return;
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function request(port) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      email: 'synthetic@example.com',
      password: 'Synthetic-Password-2026!',
    });
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/v1/auth/login',
      method: 'POST',
      timeout: 15_000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('timeout', () => request.destroy(new Error('HTTP outage probe timed out')));
    request.on('error', reject);
    request.end(requestBody);
  });
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);
  const server = await listen(app);

  try {
    const port = server.address().port;
    const response = await request(port);
    const { body } = response;

    assert.strictEqual(response.status, 503, 'Redis outage must fail closed with HTTP 503');
    assert(!body.includes('synthetic-secret'), 'Redis password leaked in response');
    assert(!body.includes('6399'), 'Redis endpoint leaked in response');
    assert(!body.includes('ECONNREFUSED'), 'Redis connection error leaked in response');
    console.log('HTTP Redis outage returned generic 503 without connection details');
  } finally {
    await close(server);
    await closeRedis().catch(() => {});
    expectedOutage = false;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
