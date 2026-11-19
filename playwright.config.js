const { defineConfig } = require('@playwright/test');
require('dotenv').config();

const mongoUri = process.env.MONGO_TEST_URI;
const port = process.env.E2E_PORT || '5187';

if (!mongoUri) {
  throw new Error('MONGO_TEST_URI is required for browser E2E tests.');
}
if (process.env.ALLOW_E2E_TEST_DB_DROP !== '1') {
  throw new Error('Set ALLOW_E2E_TEST_DB_DROP=1 to authorize the E2E suite database cleanup.');
}

const parsedUri = new URL(mongoUri);
const database = parsedUri.pathname.replace(/^\/+/, '');
if (!['localhost', '127.0.0.1', '::1'].includes(parsedUri.hostname) ||
    !database.startsWith('erp_security_e2e_')) {
  throw new Error('Browser E2E tests require a localhost database named erp_security_e2e_*.');
}

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/test-e2e-server.js',
    url: `http://127.0.0.1:${port}/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MONGO_URI: mongoUri,
      PORT: port,
      CORS_ORIGIN: `http://127.0.0.1:${port}`,
      FRONTEND_URL: `http://127.0.0.1:${port}`,
      JWT_SECRET: 'browser-e2e-only-secret-012345678901234567',
      JWT_EXPIRE: '1h',
      // E2E auth routes use the isolated in-process limiter; do not attach to a
      // developer or shared Redis server implicitly.
      REDIS_URL: '',
      EMAIL_QUEUE_PREFIX: `erp-e2e-${port}:`,
      TRUST_PROXY_HOPS: '1',
      RATE_LIMIT_KEY_PREFIX: `erp-e2e-${port}-`,
    },
  },
});
