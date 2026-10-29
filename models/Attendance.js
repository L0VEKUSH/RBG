const mongoose = require('mongoose');

const CLASS_LEVELS = [
  'Pre-Nursery', 'Nursery', 'LKG', 'UKG',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
];

const AttendanceSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: [true, 'Student is required'],
    },
    class: {
      type: String,
      required: [true, 'Class is required'],
      enum: CLASS_LEVELS,
    },
    date: {
      type: Date,
      required: [true, 'Date is required'],
    },
    status: {
      type: String,
      required: [true, 'Status is required'],
      enum: ['Present', 'Absent', 'Late', 'Half-Day', 'Leave', 'Holiday'],
      default: 'Present',
    },
    subject: {
      type: String,
      default: 'General',
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    remarks: String,
    academicYear: {
      type: String,
      required: [true, 'Academic year is required'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Unique attendance per student per date per subject
AttendanceSchema.index({ student: 1, date: 1, subject: 1 }, { unique: true });
AttendanceSchema.index({ class: 1, date: 1 });

// Static method: get attendance summary for a student
AttendanceSchema.statics.getStudentSummary = async function (studentId, academicYear) {
  const match = { student: new mongoose.Types.ObjectId(studentId) };
  if (academicYear) match.academicYear = academicYear;

  const result = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  const summary = { Present: 0, Absent: 0, Late: 0, 'Half-Day': 0, Leave: 0, Holiday: 0 };
  result.forEach((r) => { summary[r._id] = r.count; });
  const total = summary.Present + summary.Absent + summary.Late + summary['Half-Day'] + summary.Leave;
  const effective = summary.Present + summary.Late;
  summary.total = total;
  summary.percentage = total > 0 ? parseFloat(((effective / total) * 100).toFixed(2)) : 0;
  return summary;
};

// Static: get class attendance for a date
AttendanceSchema.statics.getClassAttendance = async function (cls, date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  return this.find({ class: cls, date: { $gte: start, $lte: end } })
    .populate({ path: 'student', populate: { path: 'user', select: 'name profilePhoto' } })
    .sort('student');
};

module.exports = mongoose.model('Attendance', AttendanceSchema);
