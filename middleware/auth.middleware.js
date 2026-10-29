const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ErrorResponse = require('../utils/errorResponse');
const { JWT_SECRET } = require('../config/env');

/**
 * Protect routes — verify JWT token
 */
const protect = async (req, res, next) => {
  let token;

  // Extract token from Authorization header or cookie
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
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

module.exports = { protect };
