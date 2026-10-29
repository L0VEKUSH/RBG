const mongoose = require('mongoose');

const transportAssignmentSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  bus: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bus',
    required: true
  },
  route: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Route',
    required: true
  },
  pickupStop: String,
  dropStop: String,
  academicYear: String,
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

transportAssignmentSchema.index({ student: 1, academicYear: 1 });

module.exports = mongoose.model('TransportAssignment', transportAssignmentSchema);
