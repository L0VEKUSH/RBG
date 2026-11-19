const { createClient } = require('redis');
const logger = require('../utils/logger');

const redisUrl = process.env.REDIS_URL;
const redisClient = redisUrl ? createClient({
  url: redisUrl,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries) => (
      retries >= 3 ? new Error('Redis unavailable') : Math.min(100 * (retries + 1), 1000)
    ),
  },
}) : null;
let connectPromise = null;

if (redisClient) {
  redisClient.on('error', (error) => {
    logger.error(`Redis rate-limit store error: ${error && error.code ? error.code : 'ConnectionError'}`);
  });
}

const connectRedis = async () => {
  if (!redisClient || redisClient.isReady) return;
  if (!connectPromise) {
    connectPromise = redisClient.connect().catch((error) => {
      connectPromise = null;
      throw new Error(`Redis rate-limit store unavailable: ${error && error.code ? error.code : 'ConnectionError'}`);
    });
  }
  await connectPromise;
};

const sendRedisCommand = async (...command) => {
  await connectRedis();
  if (!redisClient) throw new Error('Redis rate-limit store is not configured');
  return redisClient.sendCommand(command);
};

const closeRedis = async () => {
  if (redisClient && redisClient.isOpen) await redisClient.quit();
};

module.exports = {
  closeRedis,
  connectRedis,
  hasRedis: Boolean(redisClient),
  sendRedisCommand,
};
