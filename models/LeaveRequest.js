const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  name: String,
  url: String
});

const leaveRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userRole: String,
  leaveType: {
    type: String,
    enum: ['Sick', 'Casual', 'Earned', 'Maternity', 'Paternity', 'Other']
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
    default: 'Pending'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvalRemarks: String,
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  },
  documents: [documentSchema]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

leaveRequestSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
