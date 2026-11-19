const mongoUri = process.env.MONGO_URI;
const parsedUri = mongoUri ? new URL(mongoUri) : null;
const database = parsedUri?.pathname.replace(/^\/+/, '');

if (!parsedUri ||
    !['localhost', '127.0.0.1', '::1'].includes(parsedUri.hostname) ||
    !database.startsWith('erp_security_e2e_') ||
    process.env.NODE_ENV !== 'test') {
  throw new Error('Refusing to start E2E server with an unsafe database configuration.');
}

process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || `http://127.0.0.1:${process.env.PORT || 5187}`;
process.env.FRONTEND_URL = process.env.FRONTEND_URL || process.env.CORS_ORIGIN;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'browser-e2e-only-secret-012345678901234567';

require('../server');
