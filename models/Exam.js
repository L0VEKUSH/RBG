const mongoose = require('mongoose');

const CLASS_LEVELS = ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

const examSubjectSchema = new mongoose.Schema({
  subject: String,
  date: Date,
  startTime: String,
  endTime: String,
  room: String,
  maxMarks: Number
});

const examSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  examType: {
    type: String,
    required: true
  },
  class: {
    type: String,
    enum: CLASS_LEVELS,
    required: true
  },
  academicYear: {
    type: String,
    required: true
  },
  startDate: Date,
  endDate: Date,
  subjects: [examSubjectSchema],
  instructions: String,
  status: {
    type: String,
    enum: ['Draft', 'Scheduled', 'Ongoing', 'Completed', 'ResultPublished'],
    default: 'Draft'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

examSchema.index({ class: 1, academicYear: 1 });
examSchema.index({ startDate: 1 });
examSchema.index({ status: 1 });

module.exports = mongoose.model('Exam', examSchema);
