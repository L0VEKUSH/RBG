const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const Class = require('../models/Class');
const { protect } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/authorization.middleware');
const ErrorResponse = require('../utils/errorResponse');
const { parseSchoolDate } = require('../utils/attendance-date');
const {
  applyForAdmission, getAdmissions, getAdmissionStats, getAdmission,
  updateAdmission, updateAdmissionStatus, admitStudent, uploadAdmissionDocument,
} = require('../controllers/admission.controller');
const { createSingleUpload, handleMulterError } = require('../middleware/upload');

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

  body('section').not().exists().withMessage('Class sections are not supported'),
  body('sections').not().exists().withMessage('Class sections are not supported'),

  body('classApplyingFor')
    .notEmpty().withMessage('Class is required')
    .custom((val, { req }) => {
      try {
        req.body.classApplyingFor = Class.validateAndNormalizeClassWrite(val, 'classApplyingFor');
        return true;
      } catch (err) {
        throw new Error(err.message);
      }
    }),

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

function validateAdmissionStatusPayload(req, res, next) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return next(new ErrorResponse('A valid admission status request is required.', 400));
  }
  const allowed = new Set(['status', 'enrollmentEffectiveFrom']);
  const unexpected = Object.keys(req.body).find(field => !allowed.has(field));
  if (unexpected) return next(new ErrorResponse(`Unsupported admission status field: ${unexpected}`, 400));
  if (typeof req.body.status !== 'string') return next(new ErrorResponse('Admission status is required.', 400));
  if (Object.prototype.hasOwnProperty.call(req.body, 'enrollmentEffectiveFrom')) {
    if (req.body.status !== 'Approved') {
      return next(new ErrorResponse('Enrollment date can only be supplied while approving an admission.', 400));
    }
    try {
      parseSchoolDate(req.body.enrollmentEffectiveFrom, 'enrollment effective date');
    } catch (error) {
      return next(new ErrorResponse(error.message, 400));
    }
  }
  return next();
}

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
router.get('/', requireRole('super_admin', 'school_admin', 'principal', 'admission_officer'), getAdmissions);
router.get('/stats', requireRole('super_admin', 'school_admin', 'principal', 'admission_officer'), getAdmissionStats);
router.get('/:id', requireRole('super_admin', 'school_admin', 'principal', 'admission_officer'), getAdmission);
router.put('/:id', requireRole('super_admin', 'school_admin', 'principal', 'admission_officer'), updateAdmission);
router.post('/:id/documents', requireRole('super_admin', 'school_admin', 'principal', 'admission_officer'), createSingleUpload(['document', 'file'], 'document'), handleMulterError, uploadAdmissionDocument);
router.put('/:id/status', requireRole('super_admin', 'school_admin', 'principal', 'admission_officer'), validateAdmissionStatusPayload, updateAdmissionStatus);
router.post('/:id/admit', requireRole('super_admin', 'school_admin', 'principal', 'admission_officer'), admitStudent);

module.exports = router;
