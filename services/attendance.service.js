const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const ErrorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');

class AttendanceService {
  /**
   * Mark bulk attendance for a class
   */
  async markBulkAttendance(data, markedBy) {
    const { class: cls, date, attendanceData, academicYear, subject } = data;
    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);

    const operations = attendanceData.map((record) => ({
      updateOne: {
        filter: { student: record.student, date: attendanceDate, subject: subject || 'General' },
        update: {
          $set: {
            class: cls,
            date: attendanceDate,
            status: record.status,
            subject: subject || 'General',
            remarks: record.remarks || '',
            markedBy,
            academicYear,
          },
        },
        upsert: true,
      },
    }));

    const result = await Attendance.bulkWrite(operations);
    logger.info(`Attendance marked for Class ${cls} on ${date} by ${markedBy}`);
    return result;
  }

  /**
   * Get class attendance for a date
   */
  async getClassAttendance(cls, date) {
    return Attendance.getClassAttendance(cls, date);
  }

  /**
   * Get student attendance summary
   */
  async getStudentAttendanceSummary(studentId, academicYear) {
    return Attendance.getStudentSummary(studentId, academicYear);
  }

  /**
   * Get monthly attendance for a student
   */
  async getMonthlyAttendance(studentId, year, month) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    return Attendance.find({
      student: studentId,
      date: { $gte: start, $lte: end },
    }).sort('date');
  }

  /**
   * Get attendance report for a class (date range)
   */
  async getClassReport(cls, startDate, endDate, academicYear) {
    const students = await Student.find({ class: cls, isActive: true })
      .populate('user', 'name')
      .sort('rollNumber');

    const attendanceRecords = await Attendance.find({
      class: cls,
      date: { $gte: new Date(startDate), $lte: new Date(endDate) },
      academicYear,
    });

    const report = students.map((student) => {
      const records = attendanceRecords.filter(
        (r) => r.student.toString() === student._id.toString()
      );
      const present = records.filter((r) => r.status === 'Present').length;
      const absent = records.filter((r) => r.status === 'Absent').length;
      const late = records.filter((r) => r.status === 'Late').length;
      const total = records.length;
      return {
        student: { _id: student._id, name: student.user?.name, rollNumber: student.rollNumber },
        present, absent, late, total,
        percentage: total > 0 ? ((present / total) * 100).toFixed(2) : 0,
      };
    });

    return report;
  }

  /**
   * Update single attendance record
   */
  async updateAttendance(id, updateData, updatedBy) {
    const attendance = await Attendance.findByIdAndUpdate(
      id,
      { ...updateData, markedBy: updatedBy },
      { new: true, runValidators: true }
    );
    if (!attendance) throw new ErrorResponse('Attendance record not found', 404);
    return attendance;
  }

  /**
   * Get low attendance students (below threshold)
   */
  async getLowAttendanceStudents(cls, academicYear, threshold = 75) {
    const students = await Student.find({ class: cls, isActive: true });
    const results = await Promise.all(
      students.map(async (student) => {
        const summary = await Attendance.getStudentSummary(student._id, academicYear);
        if (parseFloat(summary.percentage) < threshold) {
          return { student, summary };
        }
        return null;
      })
    );
    return results.filter(Boolean);
  }
}

module.exports = new AttendanceService();
