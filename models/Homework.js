const mongoose = require('mongoose');

const CLASS_LEVELS = ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

const attachmentSchema = new mongoose.Schema({
  name: String,
  url: String,
  type: String
});

const submissionSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  },
  submittedAt: Date,
  content: String,
  attachments: [attachmentSchema],
  grade: String,
  feedback: String,
  status: {
    type: String,
    enum: ['Pending', 'Submitted', 'Late', 'Reviewed'],
    default: 'Pending'
  }
});

const homeworkSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  class: {
    type: String,
    enum: CLASS_LEVELS,
    required: true
  },
  subject: {
    type: String,
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  attachments: [attachmentSchema],
  submissions: [submissionSchema],
  isActive: {
    type: Boolean,
    default: true
  },
  academicYear: {
    type: String,
    required: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

homeworkSchema.index({ class: 1, subject: 1 });
homeworkSchema.index({ dueDate: 1 });

module.exports = mongoose.model('Homework', homeworkSchema);
