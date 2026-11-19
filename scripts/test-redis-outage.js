const assert = require('assert');

assert(process.env.NODE_ENV === 'test', 'NODE_ENV=test is required');
assert(process.env.REDIS_TEST_URL, 'REDIS_TEST_URL is required');
const parsed = new URL(process.env.REDIS_TEST_URL);
assert(['localhost', '127.0.0.1', '::1'].includes(parsed.hostname),
  'Redis outage tests only permit localhost');

const { connectRedis } = require('../config/redis');

(async () => {
  let error;
  try {
    await connectRedis();
  } catch (caught) {
    error = caught;
  }
  assert(error, 'Expected the isolated unavailable Redis endpoint to fail');
  assert(!error.message.includes(process.env.REDIS_TEST_URL), 'Redis URL leaked in outage error');
  assert(!error.message.includes(parsed.password || '__no_password__'), 'Redis password leaked in outage error');
  console.log('Redis outage fails closed without exposing connection details');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
