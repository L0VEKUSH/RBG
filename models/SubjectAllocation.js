const mongoose = require('mongoose');
const Class = require('./Class');

const CLASS_LEVELS = ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

const subjectAllocationSchema = new mongoose.Schema({
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Faculty',
    required: true
  },
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
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
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

subjectAllocationSchema.virtual('section').set(function () {
  this.invalidate('section', 'Class sections are not supported. RBG School ERP models single undivided classes per level.');
});
subjectAllocationSchema.virtual('sections').set(function () {
  this.invalidate('sections', 'Class sections are not supported. RBG School ERP models single undivided classes per level.');
});

subjectAllocationSchema.pre('validate', function(next) {
  if (this.section || this.sections) {
    this.invalidate('section', 'Class sections are not supported. RBG School ERP models single undivided classes per level.');
  }

  if (this.isNew || this.isModified('class')) {
    if (this.class) {
      try {
        this.class = Class.validateAndNormalizeClassWrite(this.class, 'class');
      } catch (err) {
        this.invalidate('class', err.message);
        return next();
      }
    }
  }

  next();
});

subjectAllocationSchema.index({ teacher: 1, subject: 1, class: 1, academicYear: 1 }, { unique: true });

subjectAllocationSchema.statics.CLASS_LEVELS = CLASS_LEVELS;
subjectAllocationSchema.statics.CANONICAL_CLASS_LEVELS = Class.CANONICAL_CLASS_LEVELS;

module.exports = mongoose.model('SubjectAllocation', subjectAllocationSchema);
