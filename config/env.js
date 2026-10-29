const dotenv = require('dotenv');
dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

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

module.exports = {
  NODE_ENV,
  PORT: process.env.PORT || 5000,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/school_management_db',
  JWT_SECRET,
  JWT_EXPIRE: process.env.JWT_EXPIRE || '7d',
  JWT_COOKIE_EXPIRE: parseInt(process.env.JWT_COOKIE_EXPIRE) || 7,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_EMAIL: process.env.SMTP_EMAIL,
  SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  FROM_EMAIL: process.env.FROM_EMAIL || 'noreply@sunrisepublicschool.edu.in',
  FROM_NAME: process.env.FROM_NAME || 'RBG School',
  SCHOOL_NAME: process.env.SCHOOL_NAME || 'RBG School',
  SCHOOL_ADDRESS: process.env.SCHOOL_ADDRESS || '123 Education Lane, Model Town, New Delhi - 110001, India',
  SCHOOL_PHONE: process.env.SCHOOL_PHONE || '+91-11-2345-6789',
  SCHOOL_EMAIL: process.env.SCHOOL_EMAIL || 'info@sunrisepublicschool.edu.in',
  SCHOOL_WEBSITE: process.env.SCHOOL_WEBSITE || 'http://localhost:5000',
  MAX_FILE_UPLOAD: parseInt(process.env.MAX_FILE_UPLOAD) || 5 * 1024 * 1024,
  FILE_UPLOAD_PATH: process.env.FILE_UPLOAD_PATH || './uploads',
  // Keep backward compat aliases
  COLLEGE_NAME: process.env.SCHOOL_NAME || process.env.COLLEGE_NAME || 'RBG School',
  COLLEGE_ADDRESS: process.env.SCHOOL_ADDRESS || process.env.COLLEGE_ADDRESS || '123 Education Lane, Model Town, New Delhi - 110001, India',
  COLLEGE_PHONE: process.env.SCHOOL_PHONE || process.env.COLLEGE_PHONE || '+91-11-2345-6789',
};
