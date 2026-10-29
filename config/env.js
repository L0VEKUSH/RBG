const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 5000,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/school_management_db',
  JWT_SECRET: process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET 
      ? (() => { throw new Error('FATAL ERROR: JWT_SECRET is not defined.'); })()
      : process.env.JWT_SECRET || 'fallback_secret_change_in_prod',
  JWT_EXPIRE: process.env.JWT_EXPIRE || '7d',
  JWT_COOKIE_EXPIRE: parseInt(process.env.JWT_COOKIE_EXPIRE) || 7,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_EMAIL: process.env.SMTP_EMAIL,
  SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  FROM_EMAIL: process.env.FROM_EMAIL || 'noreply@sunrisepublicschool.edu.in',
  FROM_NAME: process.env.FROM_NAME || 'Sunrise Public School',
  SCHOOL_NAME: process.env.SCHOOL_NAME || 'Sunrise Public School',
  SCHOOL_ADDRESS: process.env.SCHOOL_ADDRESS || '123 Education Lane, Model Town, New Delhi - 110001, India',
  SCHOOL_PHONE: process.env.SCHOOL_PHONE || '+91-11-2345-6789',
  SCHOOL_EMAIL: process.env.SCHOOL_EMAIL || 'info@sunrisepublicschool.edu.in',
  SCHOOL_WEBSITE: process.env.SCHOOL_WEBSITE || 'http://localhost:5000',
  MAX_FILE_UPLOAD: parseInt(process.env.MAX_FILE_UPLOAD) || 5 * 1024 * 1024,
  FILE_UPLOAD_PATH: process.env.FILE_UPLOAD_PATH || './uploads',
  // Keep backward compat aliases
  COLLEGE_NAME: process.env.SCHOOL_NAME || process.env.COLLEGE_NAME || 'Sunrise Public School',
  COLLEGE_ADDRESS: process.env.SCHOOL_ADDRESS || process.env.COLLEGE_ADDRESS || '123 Education Lane, Model Town, New Delhi - 110001, India',
  COLLEGE_PHONE: process.env.SCHOOL_PHONE || process.env.COLLEGE_PHONE || '+91-11-2345-6789',
};
