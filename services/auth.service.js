const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const ErrorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/sendEmail');
const { buildPasswordResetEmail, buildActivationEmail } = require('../utils/emailTemplates');
const mongoose = require('mongoose');
const {
  createDelivery,
  invalidateDelivery,
  requeueCurrentDelivery,
} = require('./email-delivery.service');

function expectedTokenFilter(field, value) {
  return value ? { [field]: value } : { [field]: { $exists: false } };
}

class AuthService {
  /**
   * Register a new user
   */
  async register(userData) {
    const registrationFields = ['name', 'email', 'password', 'phone', 'gender', 'dateOfBirth', 'address'];
    if (!userData || typeof userData !== 'object' || Array.isArray(userData)) {
      throw new ErrorResponse('Invalid registration data.', 400);
    }
    const unexpectedFields = Object.keys(userData).filter((field) => !registrationFields.includes(field));
    if (unexpectedFields.length) {
      throw new ErrorResponse('Unexpected registration field.', 400);
    }

    const registrationData = Object.fromEntries(
      registrationFields
        .filter((field) => Object.prototype.hasOwnProperty.call(userData, field))
        .map((field) => [field, userData[field]])
    );
    // This endpoint is not a privileged account-provisioning API. Trusted
    // workflows (admission, faculty provisioning, and seeds) create their own
    // explicitly assigned roles and never pass through this request body.
    registrationData.role = 'student';
    registrationData.permissions = [];

    const existingUser = await User.findOne({ email: registrationData.email });
    if (existingUser) {
      throw new ErrorResponse('Email already registered', 400);
    }
    const user = await User.create(registrationData);
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
   * Forgot password — generate reset token and send email.
   *
   * Security contract:
   *  - SHA-256 hash is stored; plaintext token is never persisted.
   *  - Reset URL is constructed from FRONTEND_URL env var (never from request host).
   *  - If email delivery fails, the reset token is cleared so it cannot be used.
   *  - The plaintext token and reset URL are never returned to the caller.
   *  - Internal SMTP errors are logged but not propagated to the API response.
   *  - Unknown emails return safely without throwing 404 to prevent user enumeration (H2 remediation).
   *
   * @param {string} email — User's email address
   * @returns {Promise<object>}
   */
  async forgotPassword(email) {
    // 1. Validate frontend URL and CORS origin configuration upfront.
    // Fails fast with 500 if the server is misconfigured, regardless of user existence.
    const isProduction = process.env.NODE_ENV === 'production';
    let rawBaseUrl = (process.env.FRONTEND_URL || process.env.SCHOOL_WEBSITE || '').trim();
    if (!rawBaseUrl && !isProduction) {
      rawBaseUrl = 'http://localhost:5000';
    }

    if (!rawBaseUrl) {
      logger.error('Neither FRONTEND_URL nor SCHOOL_WEBSITE is configured for production');
      throw new ErrorResponse('Server configuration error for password reset. Please contact administrator.', 500);
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawBaseUrl);
    } catch (urlErr) {
      logger.error(`Invalid frontend base URL configured: ${urlErr.message}`);
      throw new ErrorResponse('Server configuration error for password reset. Please contact administrator.', 500);
    }

    // Enforce protocol safety:
    // In production, reset URLs MUST use HTTPS. HTTP is only permitted in non-production.
    if (isProduction) {
      if (parsedUrl.protocol !== 'https:') {
        logger.error(`Insecure protocol '${parsedUrl.protocol}' rejected in production. FRONTEND_URL must use HTTPS.`);
        throw new ErrorResponse('Server configuration error for password reset. Please contact administrator.', 500);
      }
    } else {
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        logger.error(`Unsupported protocol '${parsedUrl.protocol}' configured.`);
        throw new ErrorResponse('Server configuration error for password reset. Please contact administrator.', 500);
      }
    }

    // In production, validate that the frontend origin matches an approved origin.
    // CORS_ORIGIN is used as the fail-closed allowlist of approved origins.
    if (isProduction) {
      const rawCors = (process.env.CORS_ORIGIN || '').trim();
      if (!rawCors) {
        logger.error('CORS_ORIGIN must be configured in production for password reset security.');
        throw new ErrorResponse('Server configuration error for password reset. Please contact administrator.', 500);
      }

      const entries = rawCors.split(',').map((e) => e.trim()).filter((e) => e.length > 0);
      if (entries.length === 0) {
        logger.error('CORS_ORIGIN contains no valid entries.');
        throw new ErrorResponse('Server configuration error for password reset. Please contact administrator.', 500);
      }

      const allowedOrigins = new Set();
      for (const entry of entries) {
        let entryUrl;
        try {
          entryUrl = new URL(entry);
        } catch {
          logger.error(`Malformed entry '${entry}' in CORS_ORIGIN allowlist.`);
          throw new ErrorResponse('Server configuration error for password reset. Please contact administrator.', 500);
        }

        // In production, every allowlist entry must use HTTPS.
        if (entryUrl.protocol !== 'https:') {
          logger.error(`Insecure protocol '${entryUrl.protocol}' for entry '${entry}' in production CORS_ORIGIN allowlist. Must use HTTPS.`);
          throw new ErrorResponse('Server configuration error for password reset. Please contact administrator.', 500);
        }

        allowedOrigins.add(entryUrl.origin);
      }

      if (allowedOrigins.size === 0) {
        logger.error('No valid HTTPS origins found in production CORS_ORIGIN allowlist.');
        throw new ErrorResponse('Server configuration error for password reset. Please contact administrator.', 500);
      }

      // Exact origin match required (protocol + hostname + port if non-standard).
      // No substring matching, no wildcard matching, no bypasses.
      if (!allowedOrigins.has(parsedUrl.origin)) {
        logger.error(`Frontend URL origin '${parsedUrl.origin}' is not in approved CORS_ORIGIN allowlist: [${Array.from(allowedOrigins).join(', ')}]`);
        throw new ErrorResponse('Server configuration error for password reset. Please contact administrator.', 500);
      }
    }

    // 2. Lookup user.
    // If user does not exist, mitigate timing side-channels and return generic success (H2).
    const user = await User.findOne({ email });
    if (!user) {
      // Simulate equivalent cryptographic work to prevent timing-based user enumeration
      const dummyToken = crypto.randomBytes(32).toString('hex');
      crypto.createHash('sha256').update(dummyToken).digest('hex');
      logger.info('Password reset requested for [redacted] (account not found)');
      return { success: true, user: null };
    }

    if (user.resetPasswordToken && user.resetPasswordExpire > Date.now()) {
      await requeueCurrentDelivery({
        type: 'password_reset',
        userId: user._id,
        tokenHash: user.resetPasswordToken,
      });
      return { success: true, user };
    }

    // 3. User exists: generate token, store hash, and send email.
    const previousResetToken = user.resetPasswordToken;
    const resetToken = user.getResetPasswordToken();
    const resetTokenHash = user.resetPasswordToken;
    const resetTokenExpire = user.resetPasswordExpire;
    const resetClaim = await User.updateOne({
      _id: user._id,
      ...expectedTokenFilter('resetPasswordToken', previousResetToken),
    }, {
      $set: { resetPasswordToken: resetTokenHash, resetPasswordExpire: resetTokenExpire },
    });
    if (!resetClaim.matchedCount) {
      // Another request issued or consumed a token after this read. Do not
      // overwrite its state or create an email with a token that is not current.
      return { success: true, user: null };
    }

    const frontendUrl = rawBaseUrl.replace(/\/+$/, '');
    const resetUrl = `${frontendUrl}/portal/reset-password.html?token=${encodeURIComponent(resetToken)}`;

    const schoolName = process.env.SCHOOL_NAME || 'RBG School';
    try {
      if (mongoose.connection.readyState !== 1 && process.env.NODE_ENV !== 'production') {
        const { subject, html, text } = buildPasswordResetEmail({
          name: user.name,
          resetUrl,
          schoolName,
        });
        await sendEmail({ to: user.email, subject, html, text });
      } else {
        await createDelivery({
          type: 'password_reset',
          user,
          token: resetToken,
          tokenHash: resetTokenHash,
          tokenExpiresAt: resetTokenExpire,
        });
      }
      logger.info(`Password reset email queued for: [redacted] (userId: ${user._id})`);
    } catch (emailErr) {
      // 1. Log the original delivery failure first so it is never lost
      logger.error(`Failed to send password reset email (userId: ${user._id}) [${emailErr.code || emailErr.name || 'DELIVERY_ERROR'}]`);

      // 2. Attempt to clear the reset token and expiry so stored hash cannot be used
      await User.updateOne({ _id: user._id, resetPasswordToken: resetTokenHash }, {
        $unset: { resetPasswordToken: 1, resetPasswordExpire: 1 },
      });
      try {
        await invalidateDelivery({ type: 'password_reset', userId: user._id, tokenHash: resetTokenHash });
      } catch (cleanupErr) {
        // Database cleanup write failed — document that cleanup could not be confirmed
        logger.error(
          `Critical: Database cleanup failed after email delivery error (userId: ${user._id}). Token clearance could not be confirmed.`
        );
      }

      // 3. Re-throw operational error so controller can log and suppress it from caller
      throw new ErrorResponse(
        'The password reset email could not be sent. Please try again later or contact the administrator.',
        500
      );
    }
    return { success: true, user };
  }

  /**
   * Reset password using token
   */
  async resetPassword(token, newPassword) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const user = await User.findOneAndUpdate({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
    }, {
      $set: { password: passwordHash },
      $unset: { resetPasswordToken: 1, resetPasswordExpire: 1 },
      $inc: { tokenVersion: 1 },
    }, { new: true, runValidators: true });

    if (!user) {
      throw new ErrorResponse('Invalid or expired reset token', 400);
    }

    logger.info('Password reset completed for [redacted]');
    return user;
  }

  async activateAccount(token, newPassword) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const user = await User.findOneAndUpdate({
      activationToken: hashedToken,
      activationTokenExpire: { $gt: Date.now() },
      isActive: { $ne: true },
    }, {
      $set: { password: passwordHash, isActive: true, isEmailVerified: true },
      $unset: {
        activationToken: 1,
        activationTokenExpire: 1,
        activationTokenSagaId: 1,
        activationTokenSagaGeneration: 1,
        accountInvitationType: 1,
        accountInvitationFingerprint: 1,
      },
    }, { new: true, runValidators: true });

    if (!user) {
      throw new ErrorResponse('Invalid or expired activation token', 400);
    }

    logger.info('Account activation completed for [redacted]');
    return user;
  }

  async sendActivationEmail(user, {
    deferEnqueue = false,
    relatedAdmission,
    admissionSagaId,
    admissionSagaGeneration,
    beforeTokenPersist,
    assertBeforeTokenPersist,
    afterTokenPersist,
    beforeDeliveryCreate,
  } = {}) {
    const rawBaseUrl = (process.env.FRONTEND_URL || process.env.SCHOOL_WEBSITE || '').trim();
    if (!rawBaseUrl) {
      throw new ErrorResponse('Server configuration error for account activation.', 500);
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(rawBaseUrl);
    } catch {
      throw new ErrorResponse('Server configuration error for account activation.', 500);
    }
    if (process.env.NODE_ENV === 'production' && parsedUrl.protocol !== 'https:') {
      throw new ErrorResponse('Server configuration error for account activation.', 500);
    }

    const currentUser = await User.findOne({ _id: user._id, isActive: { $ne: true } });
    if (!currentUser) {
      throw new ErrorResponse('Account is already active or unavailable.', 400);
    }
    if (currentUser.activationToken && currentUser.activationTokenExpire > Date.now()) {
      const existingDelivery = await requeueCurrentDelivery({
        type: 'activation',
        userId: currentUser._id,
        tokenHash: currentUser.activationToken,
      });
      if (existingDelivery) {
        if (admissionSagaId && existingDelivery.status === 'staged' &&
            (existingDelivery.admissionSagaId !== admissionSagaId ||
             existingDelivery.admissionSagaGeneration !== admissionSagaGeneration)) {
          throw new ErrorResponse('An activation saga is already in progress for this account.', 409);
        }
        return existingDelivery;
      }
      throw new ErrorResponse('An activation token is already active; request a new link after it expires.', 409);
    }
    const previousActivationToken = currentUser.activationToken;
    const token = currentUser.getActivationToken();
    const activationTokenHash = currentUser.activationToken;
    const activationTokenExpire = currentUser.activationTokenExpire;
    if (beforeTokenPersist) await beforeTokenPersist({
      userId: currentUser._id,
      tokenHash: activationTokenHash,
      tokenExpiresAt: activationTokenExpire,
    });
    if (assertBeforeTokenPersist) await assertBeforeTokenPersist({
      userId: currentUser._id,
      tokenHash: activationTokenHash,
      tokenExpiresAt: activationTokenExpire,
    });
    const activationUpdate = await User.updateOne({
      _id: currentUser._id,
      isActive: { $ne: true },
      ...expectedTokenFilter('activationToken', previousActivationToken),
    }, {
      $set: {
        activationToken: activationTokenHash,
        activationTokenExpire,
        ...(admissionSagaId && { activationTokenSagaId: admissionSagaId }),
        ...(admissionSagaGeneration && { activationTokenSagaGeneration: admissionSagaGeneration }),
      },
      ...(!admissionSagaId ? { $unset: { activationTokenSagaId: 1, activationTokenSagaGeneration: 1 } } : {}),
    });
    if (!activationUpdate.matchedCount) {
      throw new ErrorResponse('An activation link was issued concurrently. Request the latest link.', 409);
    }
    user.activationToken = activationTokenHash;
    user.activationTokenExpire = activationTokenExpire;
    if (afterTokenPersist) await afterTokenPersist({
      userId: currentUser._id,
      tokenHash: activationTokenHash,
      tokenExpiresAt: activationTokenExpire,
    });
    if (beforeDeliveryCreate) await beforeDeliveryCreate({
      userId: currentUser._id,
      tokenHash: activationTokenHash,
      tokenExpiresAt: activationTokenExpire,
    });

    const activationUrl =
      `${rawBaseUrl.replace(/\/+$/, '')}/portal/activate.html?token=${encodeURIComponent(token)}`;
    const schoolName = process.env.SCHOOL_NAME || 'RBG School';
    try {
      if (!relatedAdmission && mongoose.connection.readyState !== 1 && process.env.NODE_ENV !== 'production') {
        const { subject, html, text } = buildActivationEmail({
          name: user.name,
          activationUrl,
          schoolName,
        });
        await sendEmail({ to: user.email, subject, html, text });
      } else {
        return await createDelivery({
          type: 'activation',
          user,
          token,
          tokenHash: activationTokenHash,
          tokenExpiresAt: activationTokenExpire,
          deferEnqueue,
          relatedAdmission,
          admissionSagaId,
          admissionSagaGeneration,
        });
      }
    } catch (error) {
      await User.updateOne({ _id: user._id, activationToken: activationTokenHash }, {
        $unset: {
          activationToken: 1,
          activationTokenExpire: 1,
          activationTokenSagaId: 1,
          activationTokenSagaGeneration: 1,
        },
      });
      try {
        await invalidateDelivery({ type: 'activation', userId: user._id, tokenHash: activationTokenHash });
      } catch (cleanupError) {
        logger.error('Activation token cleanup failed after email delivery failure');
      }
      throw error;
    }
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
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    logger.info('Password changed for [redacted]');
    return user;
  }

  /**
   * Invalidate all sessions for a user by atomically incrementing tokenVersion
   * @param {string|mongoose.Types.ObjectId} userId
   * @returns {Promise<Object>} Updated user document
   */
  async logout(userId) {
    if (!userId) return null;
    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { tokenVersion: 1 } },
      { new: true }
    );
    if (!user) {
      throw new ErrorResponse('User not found', 404);
    }
    logger.info('User session revoked via logout for [redacted]');
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
