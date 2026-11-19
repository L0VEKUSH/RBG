const { body } = require('express-validator');
const ErrorResponse = require('../utils/errorResponse');
const { parseSchoolDate } = require('../utils/attendance-date');
const Student = require('../models/Student');
const Class = require('../models/Class');

const LEGACY_FINANCIAL_FIELDS = new Set([
  'fees', 'totalFees', 'paidFees', 'paidAmount', 'discount', 'dueFees',
  'feeStructure', 'payments', 'payment', 'receipt', 'receiptNumber',
  'receivedBy', 'collectedBy', 'collector', 'scholarship', 'fine', 'balanceDue',
]);

function rejectLegacyStudentFinancialFields(req, res, next) {
  const bodyValue = req.body;
  if (!bodyValue || typeof bodyValue !== 'object' || Array.isArray(bodyValue)) {
    return next(new ErrorResponse('A valid student request object is required', 400));
  }
  const forbidden = Object.keys(bodyValue).find((field) =>
    LEGACY_FINANCIAL_FIELDS.has(field) || field.startsWith('fees.')
  );
  if (forbidden) {
    return next(new ErrorResponse(
      'Financial fields cannot be set through student endpoints; use the fee ledger workflow',
      400
    ));
  }
  return next();
}

const createStudentValidation = [
  body('name').trim().notEmpty().withMessage('Student name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email').trim().notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('section').not().exists().withMessage('Class sections are not supported'),
  body('sections').not().exists().withMessage('Class sections are not supported'),
  body('class').notEmpty().withMessage('Class is required')
    .custom((val, { req }) => {
      try {
        req.body.class = Class.validateAndNormalizeClassWrite(val, 'Class');
        return true;
      } catch (err) {
        throw new Error(err.message);
      }
    }),
  body('rollNumber').notEmpty().withMessage('Roll number is required')
    .isNumeric().withMessage('Roll number must be a number'),
  body('academicYear').notEmpty().withMessage('Academic year is required')
    .matches(/^\d{4}-\d{4}$/).withMessage('Format: 2024-2025'),
  body('enrollmentEffectiveFrom').notEmpty()
    .custom(value => { parseSchoolDate(value, 'enrollment effective date'); return true; })
    .withMessage('An explicit enrollment effective date in YYYY-MM-DD format is required'),
  body('father.name').notEmpty().withMessage("Father's name is required"),
  body('mother.name').notEmpty().withMessage("Mother's name is required"),
  body('dateOfBirth').notEmpty().withMessage('Date of birth is required')
    .isISO8601().withMessage('Invalid date format'),
  body('gender').notEmpty().withMessage('Gender is required')
    .isIn(['male', 'female', 'other']).withMessage('Invalid gender'),
];

const updateStudentValidation = [
  body('section').not().exists().withMessage('Class sections are not supported'),
  body('sections').not().exists().withMessage('Class sections are not supported'),
  body('class').optional()
    .custom((val, { req }) => {
      try {
        req.body.class = Class.validateAndNormalizeClassWrite(val, 'Class');
        return true;
      } catch (err) {
        throw new Error(err.message);
      }
    }),
  body('rollNumber').optional().isNumeric().withMessage('Roll number must be a number'),
];

const transferCertificateValidation = [
  body('lastEnrolledDate').notEmpty()
    .custom(value => { parseSchoolDate(value, 'last-enrolled date'); return true; })
    .withMessage('An explicit last-enrolled date in YYYY-MM-DD format is required'),
  body('remarks').optional().isString().isLength({ max: 1000 }),
];

module.exports = {
  createStudentValidation,
  updateStudentValidation,
  rejectLegacyStudentFinancialFields,
  transferCertificateValidation,
};
