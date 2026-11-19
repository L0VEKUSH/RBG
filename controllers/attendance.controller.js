const attendanceService = require('../services/attendance.service');

/**
 * @desc    Mark bulk attendance for a class
 * @route   POST /api/v1/attendance/mark
 * @access  Private (Admin, Faculty)
 */
exports.markAttendance = async (req, res) => {
  let result;
  try {
    result = await attendanceService.markBulkAttendance(req.body, req.user);
  } catch (error) {
    if (error.code === 'ATTENDANCE_OUTCOME_UNKNOWN') {
      return res.status(503).json({
        success: false,
        code: error.code,
        outcome: 'unknown',
        operationId: error.operationId,
        message: error.message,
      });
    }
    throw error;
  }
  res.status(201).json({
    success: true,
    message: 'Attendance marked successfully',
    data: {
      modified: result.modifiedCount,
      upserted: result.upsertedCount,
      result,
    },
  });
};

/**
 * @desc    Get class attendance for a date
 * @route   GET /api/v1/attendance/class/:class/
 * @access  Private (Admin, Faculty)
 */
exports.getClassAttendance = async (req, res) => {
  const { date, academicYear, subject } = req.query;
  const result = await attendanceService.getClassAttendance(
    req.params.class, date, academicYear, req.user, subject
  );
  res.status(200).json({
    success: true,
    count: result.records.length,
    data: { records: result.records, students: result.students },
  });
};

/**
 * @desc    Get student attendance summary
 * @route   GET /api/v1/attendance/student/:studentId/summary
 * @access  Private
 */
exports.getStudentAttendanceSummary = async (req, res) => {
  const { academicYear } = req.query;
  const summary = await attendanceService.getStudentAttendanceSummary(
    req.params.studentId, academicYear, req.user
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
    year,
    month,
    req.user,
    req.query.academicYear
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
  const report = await attendanceService.getClassReport(cls, startDate, endDate, academicYear, req.user);
  res.status(200).json({ success: true, data: { report } });
};

/**
 * @desc    Update attendance record
 * @route   PUT /api/v1/attendance/:id
 * @access  Private (Admin, Faculty)
 */

exports.updateAttendance = async (req, res) => {
  let attendance;
  try {
    attendance = await attendanceService.updateAttendance(req.params.id, req.body, req.user);
  } catch (error) {
    if (error.code === 'ATTENDANCE_OUTCOME_UNKNOWN') {
      return res.status(503).json({
        success: false,
        code: error.code,
        outcome: 'unknown',
        operationId: error.operationId,
        message: error.message,
      });
    }
    throw error;
  }

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
    cls, academicYear, threshold === undefined ? 75 : Number(threshold), req.user
  );
  res.status(200).json({ success: true, count: students.length, data: { students } });
};
