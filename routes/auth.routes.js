const express = require('express');
const router = express.Router();
const {
  register, login, logout, getMe, updateProfile,
  changePassword, forgotPassword, resetPassword,
} = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  registerValidation, loginValidation,
  changePasswordValidation, forgotPasswordValidation, resetPasswordValidation,
} = require('../validators/auth.validator');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');

router.post('/register', protect, requireRole('super_admin', 'school_admin', 'admin'), registerValidation, validate, register);
router.post('/login', loginValidation, validate, login);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.put('/update-profile', protect, updateProfile);
router.put('/change-password', protect, changePasswordValidation, validate, changePassword);
router.post('/forgot-password', forgotPasswordValidation, validate, forgotPassword);
router.put('/reset-password/:token', resetPasswordValidation, validate, resetPassword);

module.exports = router;
