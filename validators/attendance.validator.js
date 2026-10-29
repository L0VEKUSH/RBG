const { body } = require('express-validator');

const markAttendanceValidation = [
  body('class').notEmpty().withMessage('Class is required')
    .isIn(['1','2','3','4','5','6','7','8','9','10','11','12']).withMessage('Invalid class'),
  body('date').notEmpty().withMessage('Date is required')
    .isISO8601().withMessage('Invalid date format'),
  body('academicYear').notEmpty().withMessage('Academic year is required'),
  body('attendanceData').isArray({ min: 1 }).withMessage('Attendance data must be a non-empty array'),
  body('attendanceData.*.student').notEmpty().withMessage('Student ID is required'),
  body('attendanceData.*.status')
    .notEmpty().withMessage('Status is required')
    .isIn(['Present','Absent','Late','Half-Day','Holiday']).withMessage('Invalid status'),
];

const updateAttendanceValidation = [
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['Present','Absent','Late','Half-Day','Holiday']).withMessage('Invalid status'),
];

module.exports = { markAttendanceValidation, updateAttendanceValidation };
