const dotenv = require('dotenv');
const { validateProductionEmailApplicationConfig } = require('../utils/email-production-config');
// Tests must be fully driven by explicit synthetic process variables and must
// never load developer-local environment files as an implicit side effect.
if (process.env.NODE_ENV !== 'test') dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// Validate the transport mode and encrypted-token key configuration in both
// web and worker processes. SMTP credentials remain worker-only validation.
validateProductionEmailApplicationConfig(process.env, NODE_ENV);

const getCorsOrigins = () => {
  const raw = (process.env.CORS_ORIGIN || '').trim();
  if (!raw) {
    if (isProduction) throw new Error('FATAL ERROR: CORS_ORIGIN is required in production.');
    return ['http://localhost:5000'];
  }

  const origins = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (origins.length === 0 || origins.includes('*')) {
    throw new Error('FATAL ERROR: CORS_ORIGIN must contain explicit origins.');
  }

  return origins.map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('FATAL ERROR: CORS_ORIGIN contains an invalid origin.');
    }

    if (isProduction && parsed.protocol !== 'https:') {
      throw new Error('FATAL ERROR: CORS_ORIGIN must contain only HTTPS origins in production.');
    }
    if (parsed.username || parsed.password || parsed.pathname !== '/' ||
        parsed.search || parsed.hash) {
      throw new Error('FATAL ERROR: CORS_ORIGIN contains an invalid origin.');
    }
    return parsed.origin;
  });
};

// ── Production secret validation ─────────────────────────────────────────────
// Known insecure development defaults that MUST NOT appear in production.
const KNOWN_WEAK_SECRETS = [
  'fallback_secret_change_in_prod',
  'your_super_secret_jwt_key_here_change_in_production',
  'secret',
  'changeme',
  'jwt_secret',
  'dev_secret'
];

const getRequiredSecret = (envVar, weakDefaults = KNOWN_WEAK_SECRETS) => {
  const value = process.env[envVar];
  if (isProduction) {
    if (!value) {
      throw new Error(`FATAL ERROR: ${envVar} is not set. Set this environment variable before starting in production.`);
    }
    if (value.length < 32) {
      throw new Error(`FATAL ERROR: ${envVar} is too short (minimum 32 characters required for production).`);
    }
    if (weakDefaults.includes(value)) {
      throw new Error(`FATAL ERROR: ${envVar} is set to a known insecure development default. Change it before deploying.`);
    }
  }
  return value;
};

const JWT_SECRET = getRequiredSecret('JWT_SECRET') || 'fallback_secret_change_in_prod';

const REDIS_URL = process.env.REDIS_URL || '';
if (isProduction && !REDIS_URL) {
  throw new Error('FATAL ERROR: REDIS_URL is required in production for distributed rate limiting.');
}
if (REDIS_URL) {
  try {
    const parsedRedisUrl = new URL(REDIS_URL);
    if (!['redis:', 'rediss:'].includes(parsedRedisUrl.protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error('FATAL ERROR: REDIS_URL must be a valid redis:// or rediss:// URL.');
  }
}

const TRUST_PROXY_HOPS = parseInt(process.env.TRUST_PROXY_HOPS || '0', 10);
if (!Number.isInteger(TRUST_PROXY_HOPS) || TRUST_PROXY_HOPS < 0 || TRUST_PROXY_HOPS > 10) {
  throw new Error('FATAL ERROR: TRUST_PROXY_HOPS must be an integer from 0 to 10.');
}

require('../utils/tokenMaterial').validateEncryptionConfig(process.env, isProduction);

// In production, MONGO_URI must be set and must NOT point to localhost.
if (isProduction) {
  const mongoUri = process.env.MONGO_URI || '';
  if (!mongoUri) {
    throw new Error('FATAL ERROR: MONGO_URI is not set for production.');
  }
  if (mongoUri.includes('localhost') || mongoUri.includes('127.0.0.1')) {
    throw new Error('FATAL ERROR: MONGO_URI points to localhost in production. Use a remote MongoDB URI.');
  }
}

const CORS_ORIGINS = getCorsOrigins();

module.exports = {
  NODE_ENV,
  PORT: process.env.PORT || 5000,
  CORS_ORIGIN: CORS_ORIGINS.join(','),
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/school_management_db',
  JWT_SECRET,
  JWT_EXPIRE: process.env.JWT_EXPIRE || '7d',
  JWT_COOKIE_EXPIRE: parseInt(process.env.JWT_COOKIE_EXPIRE) || 7,
  REDIS_URL,
  TRUST_PROXY_HOPS,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || process.env.SMTP_EMAIL,
  SMTP_PASS: process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
  SMTP_EMAIL: process.env.SMTP_EMAIL || process.env.SMTP_USER,
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || process.env.SMTP_PASS,
  FROM_EMAIL: process.env.FROM_EMAIL || 'noreply@rbgschool.edu.in',
  FROM_NAME: process.env.FROM_NAME || 'RBG School',
  SCHOOL_NAME: process.env.SCHOOL_NAME || 'RBG School',
  SCHOOL_ADDRESS: process.env.SCHOOL_ADDRESS || '123 Education Lane, Model Town, New Delhi - 110001, India',
  SCHOOL_PHONE: process.env.SCHOOL_PHONE || '+91-11-2345-6789',
  SCHOOL_EMAIL: process.env.SCHOOL_EMAIL || 'info@rbgschool.edu.in',
  SCHOOL_WEBSITE: process.env.SCHOOL_WEBSITE || 'http://localhost:5000',
  FRONTEND_URL: process.env.FRONTEND_URL || process.env.SCHOOL_WEBSITE || 'http://localhost:5000',
  MAX_FILE_UPLOAD: parseInt(process.env.MAX_FILE_UPLOAD) || 5 * 1024 * 1024,
  FILE_UPLOAD_PATH: process.env.FILE_UPLOAD_PATH || './uploads',
  // Keep backward compat aliases
  COLLEGE_NAME: process.env.SCHOOL_NAME || process.env.COLLEGE_NAME || 'RBG School',
  COLLEGE_ADDRESS: process.env.SCHOOL_ADDRESS || process.env.COLLEGE_ADDRESS || '123 Education Lane, Model Town, New Delhi - 110001, India',
  COLLEGE_PHONE: process.env.SCHOOL_PHONE || process.env.COLLEGE_PHONE || '+91-11-2345-6789',
};
