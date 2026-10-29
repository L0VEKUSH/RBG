const authService = require('../services/auth.service');
const { sendTokenResponse } = require('../utils/generateToken');

/**
 * @desc    Register user
 * @route   POST /api/v1/auth/register
 * @access  Private (Admin)
 */
exports.register = async (req, res) => {
  const user = await authService.register(req.body);
  sendTokenResponse(user, 201, res, 'Registration successful');
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
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
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
  const { user, resetToken } = await authService.forgotPassword(req.body.email);
  const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${resetToken}`;
  res.status(200).json({
    success: true,
    message: 'Password reset token generated. Check your email.',
    ...(process.env.NODE_ENV === 'development' && { resetUrl }),
  });
};

/**
 * @desc    Reset password
 * @route   PUT /api/v1/auth/reset-password/:token
 * @access  Public
 */
exports.resetPassword = async (req, res) => {
  const user = await authService.resetPassword(req.params.token, req.body.password);
  sendTokenResponse(user, 200, res, 'Password reset successful');
};
