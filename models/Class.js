const mongoose = require('mongoose');

const CLASS_LEVELS = ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];


const classSchema = new mongoose.Schema({
  name: {
    type: String,
    enum: CLASS_LEVELS,
    required: true
  },
  classTeacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Faculty'
  },
  academicYear: {
    type: String,
    required: true
  },
  academicLevel: {
    type: String,
    enum: ['Pre-Primary', 'Primary', 'Middle', 'Secondary', 'Senior Secondary'],
    required: true
  },
  displayOrder: {
    type: Number,
    required: true
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

classSchema.index({ name: 1, academicYear: 1 }, { unique: true });

module.exports = mongoose.model('Class', classSchema);
