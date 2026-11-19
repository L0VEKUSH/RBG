const express = require('express');
const router = express.Router();

const {
  markAttendance,
  getClassAttendance,
  getStudentAttendanceSummary,
  getMonthlyAttendance,
  getClassReport,
  updateAttendance,
  getLowAttendance,
} = require('../controllers/attendance.controller');

const { protect } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/authorization.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  markAttendanceValidation,
  updateAttendanceValidation
} = require('../validators/attendance.validator');

router.use(protect);

router.post('/mark', requirePermission('attendance.mark'), markAttendanceValidation, validate, markAttendance);

router.get('/class/:class', requirePermission('attendance.view', 'attendance.view-assigned'), getClassAttendance);

router.get('/report', requirePermission('attendance.report'), getClassReport);

router.get('/low', requirePermission('attendance.report'), getLowAttendance);

router.get('/student/:studentId/summary', requirePermission('attendance.view', 'attendance.view-assigned', 'attendance.view-linked', 'attendance.view-own'), getStudentAttendanceSummary);

router.get('/student/:studentId/monthly', requirePermission('attendance.view', 'attendance.view-assigned', 'attendance.view-linked', 'attendance.view-own'), getMonthlyAttendance);

router.put('/:id', requirePermission('attendance.edit-authorized'), updateAttendanceValidation, validate, updateAttendance);

module.exports = router;
