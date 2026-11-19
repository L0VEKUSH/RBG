const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ErrorResponse = require('../utils/errorResponse');
const { JWT_SECRET } = require('../config/env');

/**
 * Protect routes — verify JWT token
 */
const protect = async (req, res, next) => {
  let token;

  // Authentication is intentionally cookie-only; the browser never handles JWTs.
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return next(new ErrorResponse('Access denied. No token provided.', 401));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return next(new ErrorResponse('User not found. Token is invalid.', 401));
    }

    if (!user.isActive) {
      return next(new ErrorResponse('Your account has been deactivated. Contact admin.', 403));
    }

    if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) {
      return next(new ErrorResponse('Invalid token.', 401));
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new ErrorResponse('Invalid token.', 401));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new ErrorResponse('Token expired. Please login again.', 401));
    }
    return next(new ErrorResponse('Token verification failed.', 401));
  }
};

// Public content routes may personalize visibility when a valid session cookie
// is present, while still allowing anonymous requests.
const optionalProtect = (req, res, next) => {
  if (!req.cookies || !req.cookies.token) return next();
  return protect(req, res, next);
};

module.exports = { protect, optionalProtect };
