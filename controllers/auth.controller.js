const authService = require('../services/auth.service');
const uploadService = require('../services/upload.service');
const User = require('../models/User');
const ErrorResponse = require('../utils/errorResponse');
const { sendTokenResponse } = require('../utils/generateToken');
const logger = require('../utils/logger');

const GENERIC_FORGOT_PASSWORD_MESSAGE =
  'If an account with that email exists, a password reset link has been sent.';

/**
 * @desc    Register user
 * @route   POST /api/v1/auth/register
 * @access  Private (Admin)
 */
exports.register = async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Password-based account creation is disabled. Use the Student or Teacher invitation workflow; the account owner sets their password during activation.',
  });
};

/**
 * @desc    Login user
 * @route   POST /api/v1/auth/login
 * @access  Public
 */
exports.login = async (req, res) => {
  const { email, password } = req.body;
  const user = await authService.login(email, password, req.ip);
  sendTokenResponse(user, 200, res, 'Login successful');
};

/**
 * @desc    Logout user
 * @route   POST /api/v1/auth/logout
 * @access  Private
 */
exports.logout = async (req, res) => {
  const userId = req.user?._id || req.user?.id;
  if (userId) {
    await authService.logout(userId);
  }
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  res.status(200).json({ success: true, message: 'Logged out successfully' });
};

/**
 * @desc    Get current user profile
 * @route   GET /api/v1/auth/me
 * @access  Private
 */
exports.getMe = async (req, res) => {
  const user = await authService.getProfile(req.user.id);
  res.status(200).json({ success: true, data: { user } });
};

/**
 * @desc    Update profile
 * @route   PUT /api/v1/auth/update-profile
 * @access  Private
 */
exports.updateProfile = async (req, res) => {
  const user = await authService.updateProfile(req.user.id, req.body);
  res.status(200).json({ success: true, message: 'Profile updated', data: { user } });
};

/**
 * @desc    Change password
 * @route   PUT /api/v1/auth/change-password
 * @access  Private
 */
exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword(req.user.id, currentPassword, newPassword);
  res.status(200).json({ success: true, message: 'Password changed successfully' });
};

/**
 * @desc    Forgot password
 * @route   POST /api/v1/auth/forgot-password
 * @access  Public
 */
exports.forgotPassword = async (req, res) => {
  try {
    await authService.forgotPassword(req.body.email);
  } catch (err) {
    // If it's a server configuration error (e.g. invalid CORS_ORIGIN or FRONTEND_URL in production),
    // re-throw so the operational error is surfaced to administrators.
    if (err.statusCode === 500 && err.message && err.message.includes('Server configuration error')) {
      throw err;
    }
    // For email delivery and downstream errors, log internally but do not leak to client
    // to prevent user account enumeration and infrastructure disclosure (H2 remediation).
    logger.error(`Forgot password operational error suppressed from client: ${err.message}`);
  }

  res.status(200).json({
    success: true,
    message: GENERIC_FORGOT_PASSWORD_MESSAGE,
  });
};

/**
 * @desc    Reset password
 * @route   PUT /api/v1/auth/reset-password
 * @access  Public
 */
exports.resetPassword = async (req, res) => {
  const user = await authService.resetPassword(req.body.token, req.body.password);
  sendTokenResponse(user, 200, res, 'Password reset successful');
};

exports.activateAccount = async (req, res) => {
  await authService.activateAccount(req.body.token, req.body.password);
  res.status(200).json({
    success: true,
    message: 'Account activated successfully. You can now sign in.',
  });
};

/**
 * @desc    Upload authenticated user profile photo
 * @route   POST /api/v1/auth/profile-photo
 * @access  Private
 */
exports.uploadProfilePhoto = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new ErrorResponse('Please select a photo to upload', 400));
    }
    const saved = await uploadService.saveFile(req.file, 'profiles');
    let user;
    try {
      user = await User.findById(req.user.id || req.user._id);
      if (!user) {
        throw new ErrorResponse('User not found', 404);
      }
      const oldPhoto = user.profilePhoto;
      user.profilePhoto = saved.url;
      await user.save();

      // Delete old photo file if it was a managed upload, ONLY after DB update succeeds
      if (oldPhoto && oldPhoto !== saved.url) {
        await uploadService.safeDeleteOldUpload(oldPhoto);
      }
    } catch (dbErr) {
      // Safe cleanup of newly saved file if database update fails
      await uploadService.deleteFile(saved.filename, 'profiles');
      throw dbErr;
    }

    res.status(200).json({
      success: true,
      message: 'Profile photo updated',
      data: { profilePhoto: saved.url, user },
    });
  } catch (err) {
    next(err);
  }
};
