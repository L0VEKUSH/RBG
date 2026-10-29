const crypto = require('crypto');
const User = require('../models/User');
const ErrorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');

class AuthService {
  /**
   * Register a new user
   */
  async register(userData) {
    const existingUser = await User.findOne({ email: userData.email });
    if (existingUser) {
      throw new ErrorResponse('Email already registered', 400);
    }
    const user = await User.create(userData);
    logger.info(`New user registered: ${user.email} [${user.role}]`);
    return user;
  }

  /**
   * Login user with email/password
   */
  async login(email, password, ip) {
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      throw new ErrorResponse('Invalid email or password', 401);
    }

    if (user.isLocked) {
      throw new ErrorResponse(
        `Account locked due to too many failed attempts. Try again after ${new Date(user.lockUntil).toLocaleTimeString()}`,
        423
      );
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      await user.incrementLoginAttempts();
      throw new ErrorResponse('Invalid email or password', 401);
    }

    if (!user.isActive) {
      throw new ErrorResponse('Your account has been deactivated. Contact admin.', 403);
    }

    await user.updateLastLogin();
    logger.info(`User logged in: ${user.email} from ${ip}`);
    return user;
  }

  /**
   * Forgot password - generate reset token
   */
  async forgotPassword(email) {
    const user = await User.findOne({ email });
    if (!user) {
      throw new ErrorResponse('No account found with that email', 404);
    }
    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });
    return { user, resetToken };
  }

  /**
   * Reset password using token
   */
  async resetPassword(token, newPassword) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      throw new ErrorResponse('Invalid or expired reset token', 400);
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();
    logger.info(`Password reset for: ${user.email}`);
    return user;
  }

  /**
   * Change password (authenticated)
   */
  async changePassword(userId, currentPassword, newPassword) {
    const user = await User.findById(userId).select('+password');
    if (!user) throw new ErrorResponse('User not found', 404);

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) throw new ErrorResponse('Current password is incorrect', 401);

    user.password = newPassword;
    await user.save();
    logger.info(`Password changed for: ${user.email}`);
    return user;
  }

  /**
   * Get profile
   */
  async getProfile(userId) {
    const user = await User.findById(userId);
    if (!user) throw new ErrorResponse('User not found', 404);
    return user;
  }

  /**
   * Update profile
   */
  async updateProfile(userId, updates) {
    const allowedFields = ['name', 'phone', 'address', 'gender', 'dateOfBirth', 'profilePhoto'];
    const filteredUpdates = {};
    allowedFields.forEach((field) => {
      if (updates[field] !== undefined) filteredUpdates[field] = updates[field];
    });

    const user = await User.findByIdAndUpdate(userId, filteredUpdates, {
      new: true,
      runValidators: true,
    });
    if (!user) throw new ErrorResponse('User not found', 404);
    return user;
  }
}

module.exports = new AuthService();
