const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// All valid class levels for the school
const CLASS_LEVELS = [
  'Pre-Nursery', 'Nursery', 'LKG', 'UKG',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
];

// All roles in the system
const ROLES = [
  'super_admin', 'school_admin', 'principal', 'vice_principal',
  'academic_coordinator', 'class_teacher', 'teacher',
  'student', 'parent',
  'accountant', 'librarian', 'admission_officer', 'exam_coordinator',
  'transport_admin', 'driver', 'receptionist', 'hr', 'staff', 'nurse',
  // Keep backward compatibility with existing data
  'admin', 'faculty'
];

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: ROLES,
      default: 'student',
    },
    permissions: {
      type: [String],
      default: [],
    },
    phone: {
      type: String,
      match: [/^[6-9]\d{9}$/, 'Please enter a valid 10-digit Indian phone number'],
    },
    profilePhoto: {
      type: String,
      default: 'default-avatar.png',
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
    },
    dateOfBirth: {
      type: Date,
    },
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: String,
    emailVerificationExpire: Date,
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    lastLogin: Date,
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare entered password with stored hash
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate password reset token
UserSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
  return resetToken;
};

// Generate email verification token
UserSchema.methods.getEmailVerificationToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerificationExpire = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  return token;
};

// Check if account is locked
UserSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Normalized role: maps legacy roles to new roles
UserSchema.virtual('normalizedRole').get(function () {
  if (this.role === 'admin') return 'school_admin';
  if (this.role === 'faculty') return 'teacher';
  return this.role;
});

// Check if user has specific permission
UserSchema.methods.hasPermission = function (permission) {
  // Super admin and school_admin/admin have all permissions
  if (['super_admin', 'school_admin', 'admin'].includes(this.role)) return true;
  return this.permissions.includes(permission);
};

// Check if user has any of the specified permissions
UserSchema.methods.hasAnyPermission = function (...permissions) {
  if (['super_admin', 'school_admin', 'admin'].includes(this.role)) return true;
  return permissions.some(p => this.permissions.includes(p));
};

// Update last login
UserSchema.methods.updateLastLogin = async function () {
  this.lastLogin = new Date();
  this.loginAttempts = 0;
  this.lockUntil = undefined;
  await this.save({ validateBeforeSave: false });
};

// Increment failed login attempts
UserSchema.methods.incrementLoginAttempts = async function () {
  const MAX_ATTEMPTS = 5;
  const LOCK_TIME = 2 * 60 * 60 * 1000; // 2 hours

  if (this.lockUntil && this.lockUntil < Date.now()) {
    this.loginAttempts = 1;
    this.lockUntil = undefined;
  } else {
    this.loginAttempts += 1;
    if (this.loginAttempts >= MAX_ATTEMPTS) {
      this.lockUntil = Date.now() + LOCK_TIME;
    }
  }
  await this.save({ validateBeforeSave: false });
};

// Statics: export constants for reuse
UserSchema.statics.ROLES = ROLES;
UserSchema.statics.CLASS_LEVELS = CLASS_LEVELS;

module.exports = mongoose.model('User', UserSchema);
