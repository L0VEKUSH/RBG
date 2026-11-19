const express = require('express');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { hasRedis, sendRedisCommand } = require('../config/redis');
const router = express.Router();
const {
  login, logout, getMe, updateProfile, uploadProfilePhoto,
  changePassword, forgotPassword, resetPassword, activateAccount,
} = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { createSingleUpload, handleMulterError } = require('../middleware/upload');
const { validate } = require('../middleware/validate.middleware');
const {
  loginValidation,
  changePasswordValidation, forgotPasswordValidation, resetPasswordValidation,
  activationValidation,
} = require('../validators/auth.validator');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { rejectLegacyPasswordCreation } = require('../controllers/invitation.controller');
const rateLimitKeyPrefix = process.env.RATE_LIMIT_KEY_PREFIX || 'erp-auth-';

const createAuthRateLimiter = (max, prefix) => {
  if (process.env.NODE_ENV === 'production' && !hasRedis) {
    throw new Error('FATAL ERROR: Redis is required for production authentication rate limiting.');
  }

  const options = {
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: false,
    keyGenerator: (req) => req.ip,
    handler: (req, res) => res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
    }),
  };

  if (hasRedis) {
    options.store = new RedisStore({ prefix, sendCommand: sendRedisCommand });
  }
  const limiter = rateLimit(options);
  return async (req, res, next) => {
    let middlewareError;
    try {
      await limiter(req, res, (error) => {
        middlewareError = error;
        if (!error) next();
      });
      if (middlewareError) throw middlewareError;
    } catch (error) {
      res.status(503).json({
        success: false,
        message: 'This security service is temporarily unavailable. Please try again later.',
      });
    }
  };
};

const recoveryRateLimiter = createAuthRateLimiter(
  parseInt(process.env.AUTH_RECOVERY_RATE_LIMIT_MAX, 10) || 5,
  `${rateLimitKeyPrefix}recovery:`
);
const activationRateLimiter = createAuthRateLimiter(
  parseInt(process.env.AUTH_ACTIVATION_RATE_LIMIT_MAX, 10) || 5,
  `${rateLimitKeyPrefix}activation:`
);
const loginRateLimiter = createAuthRateLimiter(
  parseInt(process.env.AUTH_LOGIN_RATE_LIMIT_MAX, 10) || 10,
  `${rateLimitKeyPrefix}login:`
);

router.post('/register', protect, requireRole('super_admin', 'school_admin', 'admin'), rejectLegacyPasswordCreation);
router.post('/login', loginRateLimiter, loginValidation, validate, login);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.put('/update-profile', protect, updateProfile);
router.post('/profile-photo', protect, createSingleUpload(['photo', 'profilePhoto', 'file'], 'image'), handleMulterError, uploadProfilePhoto);
router.put('/change-password', protect, changePasswordValidation, validate, changePassword);
router.post('/forgot-password', recoveryRateLimiter, forgotPasswordValidation, validate, forgotPassword);
router.put('/reset-password', recoveryRateLimiter, resetPasswordValidation, validate, resetPassword);
router.put('/activate', activationRateLimiter, activationValidation, validate, activateAccount);

module.exports = router;
