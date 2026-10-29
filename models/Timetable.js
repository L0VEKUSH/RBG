const mongoose = require('mongoose');

const CLASS_LEVELS = ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

const periodSchema = new mongoose.Schema({
  periodNumber: Number,
  startTime: String,
  endTime: String,
  subject: String,
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Faculty'
  },
  room: String,
  type: {
    type: String,
    enum: ['Regular', 'Lab', 'Library', 'Sports', 'Break', 'Assembly']
  }
});

const timetableSchema = new mongoose.Schema({
  class: {
    type: String,
    enum: CLASS_LEVELS,
    required: true
  },
  academicYear: {
    type: String,
    required: true
  },
  day: {
    type: String,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  },
  periods: [periodSchema],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

timetableSchema.index({ class: 1, academicYear: 1, day: 1 }, { unique: true });

module.exports = mongoose.model('Timetable', timetableSchema);
