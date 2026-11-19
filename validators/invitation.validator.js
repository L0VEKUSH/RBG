'use strict';

const { body } = require('express-validator');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const { parseSchoolDate } = require('../utils/attendance-date');

const optionalPhone = () => body('phone').optional()
  .matches(/^[6-9]\d{9}$/).withMessage('Phone must be a valid 10-digit Indian number');

const commonUserFields = () => [
  body('name').trim().notEmpty().isLength({ min: 2, max: 100 })
    .withMessage('Name must be 2-100 characters'),
  body('email').trim().notEmpty().isEmail().withMessage('A valid email is required').normalizeEmail(),
  optionalPhone(),
];

const studentInvitationValidation = [
  ...commonUserFields(),
  body('gender').notEmpty().isIn(['male', 'female', 'other'])
    .withMessage('A valid student gender is required'),
  body('dateOfBirth').notEmpty().isISO8601().withMessage('A valid date of birth is required'),
  body('class').notEmpty().isIn(Student.CLASS_LEVELS).withMessage('Choose a valid class'),
  body('rollNumber').notEmpty().isNumeric().withMessage('Roll number must be numeric'),
  body('academicYear').notEmpty().matches(/^\d{4}-\d{4}$/)
    .withMessage('Academic year must use YYYY-YYYY format'),
  body('enrollmentEffectiveFrom').notEmpty().matches(/^\d{4}-\d{2}-\d{2}$/)
    .custom(value => { parseSchoolDate(value, 'enrollment effective date'); return true; })
    .withMessage('An explicit enrollment effective date in YYYY-MM-DD format is required'),
  body('father.name').trim().notEmpty().withMessage("Father's name is required"),
  body('mother.name').trim().notEmpty().withMessage("Mother's name is required"),
];

const teacherInvitationValidation = [
  ...commonUserFields(),
  body('gender').optional().isIn(['male', 'female', 'other']).withMessage('Choose a valid gender'),
  body('department').notEmpty().isIn(Faculty.schema.path('department').enumValues)
    .withMessage('Choose a valid department'),
  body('designation').notEmpty().isIn(Faculty.schema.path('designation').enumValues)
    .withMessage('Choose a valid designation'),
  body('joiningDate').notEmpty().isISO8601().withMessage('A valid joining date is required'),
];

module.exports = { studentInvitationValidation, teacherInvitationValidation };
