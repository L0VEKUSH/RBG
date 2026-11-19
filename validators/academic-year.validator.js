'use strict';

const { param, body } = require('express-validator');
const { parseSchoolDate } = require('../utils/attendance-date');

const academicYearIdValidation = [
  param('id').custom(value => {
    if (!/^[a-f\d]{24}$/i.test(value)) throw new Error('Academic year ID must be a valid MongoDB ID');
    return true;
  }),
];

const academicYearCreateValidation = [
  body('name').isString().withMessage('Academic year name is required').trim()
    .matches(/^\d{4}-\d{4}$/).withMessage('Academic year name must use YYYY-YYYY format'),
  body('startDate').isString().withMessage('Academic year start date is required')
    .custom(value => { parseSchoolDate(value, 'academic year start date'); return true; })
    .withMessage('Academic year start date must be a valid YYYY-MM-DD school date'),
  body('endDate').isString().withMessage('Academic year end date is required')
    .custom(value => { parseSchoolDate(value, 'academic year end date'); return true; })
    .withMessage('Academic year end date must be a valid YYYY-MM-DD school date'),
  body('terms').optional().isArray().withMessage('Academic year terms must be an array'),
];

const academicYearUpdateValidation = [
  body('name').optional().isString().trim()
    .matches(/^\d{4}-\d{4}$/).withMessage('Academic year name must use YYYY-YYYY format'),
  body('startDate').optional().isString()
    .custom(value => { parseSchoolDate(value, 'academic year start date'); return true; })
    .withMessage('Academic year start date must be a valid YYYY-MM-DD school date'),
  body('endDate').optional().isString()
    .custom(value => { parseSchoolDate(value, 'academic year end date'); return true; })
    .withMessage('Academic year end date must be a valid YYYY-MM-DD school date'),
  body('terms').optional().isArray().withMessage('Academic year terms must be an array'),
];

module.exports = {
  academicYearIdValidation,
  academicYearCreateValidation,
  academicYearUpdateValidation,
};
