const attendanceService = require('../services/attendance.service');

/**
 * @desc    Mark bulk attendance for a class
 * @route   POST /api/v1/attendance/mark
 * @access  Private (Admin, Faculty)
 */
exports.markAttendance = async (req, res) => {
  const result = await attendanceService.markBulkAttendance(req.body, req.user.id);
  res.status(201).json({
    success: true,
    message: 'Attendance marked successfully',
    data: { modified: result.modifiedCount, upserted: result.upsertedCount },
  });
};

/**
 * @desc    Get class attendance for a date
 * @route   GET /api/v1/attendance/class/:class/
 * @access  Private (Admin, Faculty)
 */
exports.getClassAttendance = async (req, res) => {
  const { date } = req.query;
  const records = await attendanceService.getClassAttendance(
    req.params.class, req.params.pageBlock, date || new Date()
  );
  res.status(200).json({ success: true, count: records.length, data: { records } });
};

/**
 * @desc    Get student attendance summary
 * @route   GET /api/v1/attendance/student/:studentId/summary
 * @access  Private
 */
exports.getStudentAttendanceSummary = async (req, res) => {
  const { academicYear } = req.query;
  const summary = await attendanceService.getStudentAttendanceSummary(
    req.params.studentId, academicYear
  );
  res.status(200).json({ success: true, data: { summary } });
};

/**
 * @desc    Get monthly attendance for a student
 * @route   GET /api/v1/attendance/student/:studentId/monthly
 * @access  Private
 */
exports.getMonthlyAttendance = async (req, res) => {
  const { year, month } = req.query;
  const records = await attendanceService.getMonthlyAttendance(
    req.params.studentId,
    parseInt(year) || new Date().getFullYear(),
    parseInt(month) || new Date().getMonth() + 1
  );
  res.status(200).json({ success: true, count: records.length, data: { records } });
};

/**
 * @desc    Get class attendance report (date range)
 * @route   GET /api/v1/attendance/report
 * @access  Private (Admin, Faculty)
 */
exports.getClassReport = async (req, res) => {
  const { class: cls, startDate, endDate, academicYear } = req.query;
  const report = await attendanceService.getClassReport(cls, startDate, endDate, academicYear);
  res.status(200).json({ success: true, data: { report } });
};

/**
 * @desc    Update attendance record
 * @route   PUT /api/v1/attendance/:id
 * @access  Private (Admin, Faculty)
 */

exports.updateAttendance = async (req, res) => {

  // 🔒 HARD SECURITY CHECK
  if (!['admin', 'faculty'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Only admin or faculty can update attendance'
    });
  }

  const attendance = await attendanceService.updateAttendance(
    req.params.id,
    req.body,
    req.user.id
  );

  res.status(200).json({
    success: true,
    message: 'Attendance updated',
    data: { attendance }
  });
};
/**
 * @desc    Get low attendance students
 * @route   GET /api/v1/attendance/low
 * @access  Private (Admin, Faculty)
 */
exports.getLowAttendance = async (req, res) => {
  const { class: cls, academicYear, threshold } = req.query;
  const students = await attendanceService.getLowAttendanceStudents(
    cls, academicYear, parseFloat(threshold) || 75
  );
  res.status(200).json({ success: true, count: students.length, data: { students } });
};
