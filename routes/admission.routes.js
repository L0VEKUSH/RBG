const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/authorization.middleware');
const {
  applyForAdmission, getAdmissions, getAdmissionStats, getAdmission,
  updateAdmission, updateAdmissionStatus, admitStudent
} = require('../controllers/admission.controller');

const router = express.Router();

// ── Public admissions endpoint hardening ──────────────────────────
// Dedicated rate limiter: max 5 applications per IP per 15 minutes
const admissionRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.ADMISSION_RATE_LIMIT_MAX) || 5,
  message: { success: false, message: 'Too many applications submitted. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict field whitelist validator — strips ALL extra fields, enforces types
const admissionValidator = [
  body('studentName')
    .trim().notEmpty().withMessage('Student name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Student name must be 2–100 characters')
    .matches(/^[a-zA-Z\s'-]+$/).withMessage('Student name contains invalid characters'),

  body('dateOfBirth')
    .notEmpty().withMessage('Date of birth is required')
    .isISO8601().withMessage('Date of birth must be a valid date')
    .custom(val => {
      const dob = new Date(val);
      const now = new Date();
      const age = (now - dob) / (365.25 * 24 * 60 * 60 * 1000);
      if (age < 2 || age > 25) throw new Error('Date of birth is out of expected range for school admission');
      return true;
    }),

  body('classApplyingFor')
    .notEmpty().withMessage('Class is required')
    .isIn(['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
    .withMessage('Invalid class value'),

  body('gender')
    .optional()
    .isIn(['male', 'female', 'other']).withMessage('Gender must be male, female, or other'),

  body('fatherName').optional().trim().isLength({ max: 100 }),
  body('motherName').optional().trim().isLength({ max: 100 }),
  body('guardianName').optional().trim().isLength({ max: 100 }),

  body('fatherPhone').optional().matches(/^[+\d\s-]{7,20}$/).withMessage('Invalid phone number'),
  body('motherPhone').optional().matches(/^[+\d\s-]{7,20}$/).withMessage('Invalid phone number'),
  body('guardianPhone').optional().matches(/^[+\d\s-]{7,20}$/).withMessage('Invalid phone number'),

  body('fatherEmail').optional().isEmail().normalizeEmail(),
  body('motherEmail').optional().isEmail().normalizeEmail(),

  body('stream')
    .optional()
    .isIn(['Science', 'Commerce', 'Humanities', '']).withMessage('Invalid stream'),

  body('address.city').optional().trim().isLength({ max: 100 }),
  body('address.state').optional().trim().isLength({ max: 100 }),
  body('address.pincode').optional().matches(/^\d{6}$/).withMessage('Pincode must be 6 digits'),

  // Security: block any attempt to inject privileged fields
  body('role').not().exists().withMessage('Field not permitted'),
  body('user').not().exists().withMessage('Field not permitted'),
  body('status').not().exists().withMessage('Field not permitted — status is set by the admission office'),
  body('reviewedBy').not().exists().withMessage('Field not permitted'),
  body('createdStudent').not().exists().withMessage('Field not permitted'),
  body('isAdmin').not().exists().withMessage('Field not permitted'),
];

// Validation error handler middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Return field-level errors but never echo back raw DB info
    return res.status(422).json({
      success: false,
      message: 'Please correct the form errors and resubmit.',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  // Build a strict whitelist payload — no extra fields pass through
  req.admissionPayload = {
    studentName: req.body.studentName,
    dateOfBirth: req.body.dateOfBirth,
    classApplyingFor: req.body.classApplyingFor,
    ...(req.body.gender    && { gender: req.body.gender }),
    ...(req.body.fatherName   && { fatherName: req.body.fatherName }),
    ...(req.body.motherName   && { motherName: req.body.motherName }),
    ...(req.body.guardianName && { guardianName: req.body.guardianName }),
    ...(req.body.fatherPhone  && { fatherPhone: req.body.fatherPhone }),
    ...(req.body.motherPhone  && { motherPhone: req.body.motherPhone }),
    ...(req.body.guardianPhone && { guardianPhone: req.body.guardianPhone }),
    ...(req.body.fatherEmail  && { fatherEmail: req.body.fatherEmail }),
    ...(req.body.motherEmail  && { motherEmail: req.body.motherEmail }),
    ...(req.body.stream       && { stream: req.body.stream }),
    ...(req.body.address      && { address: {
      city: req.body.address?.city,
      state: req.body.address?.state,
      pincode: req.body.address?.pincode,
    }}),
    // Status always starts as Submitted — never from client
    status: 'Submitted',
  };
  next();
};

// Public admission application route — hardened
router.post(
  '/apply',
  admissionRateLimiter,
  admissionValidator,
  handleValidationErrors,
  applyForAdmission,
);

// ── Protected routes ──────────────────────────────────────────────
router.use(protect);
router.get('/', requireRole('super_admin', 'school_admin', 'admission_officer'), getAdmissions);
router.get('/stats', requireRole('super_admin', 'school_admin', 'admission_officer'), getAdmissionStats);
router.get('/:id', requireRole('super_admin', 'school_admin', 'admission_officer'), getAdmission);
router.put('/:id', requireRole('super_admin', 'school_admin', 'admission_officer'), updateAdmission);
router.put('/:id/status', requireRole('super_admin', 'school_admin', 'admission_officer'), updateAdmissionStatus);
router.post('/:id/admit', requireRole('super_admin', 'school_admin', 'admission_officer'), admitStudent);

module.exports = router;
