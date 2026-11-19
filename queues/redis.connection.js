'use strict';

function parseRedisUrl(redisUrl) {
  if (!redisUrl) return null;
  const parsed = new URL(redisUrl);
  if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  const databasePath = parsed.pathname.replace(/^\//, '');
  if (databasePath && !/^\d+$/.test(databasePath)) {
    throw new Error('REDIS_URL database path must be a non-negative integer');
  }
  if (parsed.pathname.split('/').filter(Boolean).length > 1) {
    throw new Error('REDIS_URL must contain at most one database path segment');
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const connection = {
    host,
    port: Number(parsed.port || 6379),
    db: databasePath ? Number(databasePath) : 0,
  };
  if (parsed.username) connection.username = decodeURIComponent(parsed.username);
  if (parsed.password) connection.password = decodeURIComponent(parsed.password);
  if (parsed.protocol === 'rediss:') {
    connection.tls = {};
    const servername = parsed.searchParams.get('servername');
    if (servername) connection.tls.servername = servername;
  }
  return connection;
}

const redisUrl = process.env.REDIS_URL;
const connection = parseRedisUrl(redisUrl);

module.exports = { connection, parseRedisUrl, redisUrl };
