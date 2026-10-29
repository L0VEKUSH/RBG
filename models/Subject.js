const mongoose = require('mongoose');

const CLASS_LEVELS = ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

const subjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    unique: true,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['Core', 'Elective', 'Language', 'Co-Curricular'],
    required: true
  },
  department: {
    type: String,
    trim: true
  },
  classLevels: [{
    type: String,
    enum: CLASS_LEVELS
  }],
  creditHours: {
    type: Number
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


module.exports = mongoose.model('Subject', subjectSchema);
