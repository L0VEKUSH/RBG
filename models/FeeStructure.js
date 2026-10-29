const mongoose = require('mongoose');

const CLASS_LEVELS = ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

const componentSchema = new mongoose.Schema({
  name: String,
  amount: Number,
  dueDate: Date,
  type: {
    type: String,
    enum: ['Tuition', 'Admission', 'Annual', 'Transport', 'Activity', 'Exam', 'Lab', 'Library', 'Other']
  }
});

const feeStructureSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
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
  components: [componentSchema],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

feeStructureSchema.virtual('totalAmount').get(function() {
  if (!this.components || this.components.length === 0) return 0;
  return this.components.reduce((total, component) => total + (component.amount || 0), 0);
});

feeStructureSchema.index({ class: 1, academicYear: 1 });

module.exports = mongoose.model('FeeStructure', feeStructureSchema);
