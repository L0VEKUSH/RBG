const { body } = require('express-validator');
const { parseSchoolDate } = require('../utils/attendance-date');

const markAttendanceValidation = [
  body('class').notEmpty().withMessage('Class is required')
    .isIn(['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1','2','3','4','5','6','7','8','9','10','11','12'])
    .withMessage('Invalid class'),
  body('date').notEmpty().withMessage('Date is required')
    .custom(value => { parseSchoolDate(value); return true; })
    .withMessage('Date must be a valid YYYY-MM-DD school date'),
  body('academicYear').notEmpty().withMessage('Academic year is required')
    .matches(/^\d{4}-\d{4}$/).withMessage('Invalid academic year'),
  body('attendanceData').isArray({ min: 1 }).withMessage('Attendance data must be a non-empty array'),
  body('attendanceData.*.student').notEmpty().withMessage('Student ID is required'),
  body('attendanceData.*.status')
    .notEmpty().withMessage('Status is required')
    .isIn(['Present','Absent','Late','Half-Day','Holiday']).withMessage('Invalid status'),
  body('attendanceData.*.expectedRevision')
    .custom(value => value === null || (Number.isSafeInteger(value) && value >= 0))
    .withMessage('Expected revision must be a nonnegative integer or null'),
];

const updateAttendanceValidation = [
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['Present','Absent','Late','Half-Day','Holiday']).withMessage('Invalid status'),
  body('expectedRevision')
    .custom(value => Number.isSafeInteger(value) && value >= 0)
    .withMessage('Expected revision must be a nonnegative integer'),
];

module.exports = { markAttendanceValidation, updateAttendanceValidation };
