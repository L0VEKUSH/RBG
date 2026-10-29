const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRE, JWT_COOKIE_EXPIRE } = require('../config/env');

/**
 * Generate JWT token for a user
 * @param {Object} payload - Data to encode in token
 * @returns {string} JWT token
 */
const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRE });
};

/**
 * Send token response with cookie
 * @param {Object} user - User document
 * @param {number} statusCode - HTTP status code
 * @param {Object} res - Express response object
 * @param {string} message - Response message
 */
const sendTokenResponse = (user, statusCode, res, message = 'Success') => {
  const token = generateToken({ id: user._id, role: user.role });

  const cookieOptions = {
    expires: new Date(Date.now() + JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  };

  const userResponse = {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    profilePhoto: user.profilePhoto,
  };

  res
    .status(statusCode)
    .cookie('token', token, cookieOptions)
    .json({
      success: true,
      message,
      
      data: { user: userResponse,
        token: token
       },
    });
};

module.exports = { generateToken, sendTokenResponse };
