const { body } = require('express-validator');

const createStudentValidation = [
  body('name').trim().notEmpty().withMessage('Student name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email').trim().notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('class').notEmpty().withMessage('Class is required')
    .isIn(['1','2','3','4','5','6','7','8','9','10','11','12']).withMessage('Invalid class'),
  body('rollNumber').notEmpty().withMessage('Roll number is required')
    .isNumeric().withMessage('Roll number must be a number'),
  body('academicYear').notEmpty().withMessage('Academic year is required')
    .matches(/^\d{4}-\d{4}$/).withMessage('Format: 2024-2025'),
  body('father.name').notEmpty().withMessage("Father's name is required"),
  body('mother.name').notEmpty().withMessage("Mother's name is required"),
  body('dateOfBirth').notEmpty().withMessage('Date of birth is required')
    .isISO8601().withMessage('Invalid date format'),
  body('gender').notEmpty().withMessage('Gender is required')
    .isIn(['male', 'female', 'other']).withMessage('Invalid gender'),
];

const updateStudentValidation = [
  body('class').optional()
    .isIn(['1','2','3','4','5','6','7','8','9','10','11','12']).withMessage('Invalid class'),
  body('rollNumber').optional().isNumeric().withMessage('Roll number must be a number'),
];

module.exports = { createStudentValidation, updateStudentValidation };
