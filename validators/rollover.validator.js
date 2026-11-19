'use strict';

const { body, param } = require('express-validator');

const rolloverIdValidation = [
  param('id').isMongoId().withMessage('A valid rollover ID is required'),
];

const rolloverCreateValidation = [
  body('sourceAcademicYear').isString().matches(/^\d{4}-\d{4}$/).withMessage('A valid source academic year is required'),
  body('destinationAcademicYear').isString().matches(/^\d{4}-\d{4}$/).withMessage('A valid destination academic year is required'),
];

const rolloverDecisionsValidation = [
  body('decisions').isArray().withMessage('decisions must be an array'),
  body('expectedRevision').isInt({ min: 0 }).withMessage('expectedRevision must be a nonnegative integer'),
];

module.exports = { rolloverIdValidation, rolloverCreateValidation, rolloverDecisionsValidation };
