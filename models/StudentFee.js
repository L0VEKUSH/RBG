const mongoose = require('mongoose');

const paymentRecordSchema = new mongoose.Schema({
  amount: Number,
  date: Date,
  method: {
    type: String,
    enum: ['Cash', 'Cheque', 'Online', 'BankTransfer']
  },
  receiptNumber: String,
  remarks: String,
  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

const studentFeeSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  feeStructure: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FeeStructure'
  },
  class: String,
  academicYear: {
    type: String,
    required: true
  },
  totalAmount: Number,
  paidAmount: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  scholarship: {
    type: Number,
    default: 0
  },
  fine: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['Pending', 'Partial', 'Paid', 'Overdue', 'Waived'],
    default: 'Pending'
  },
  dueDate: Date,
  payments: [paymentRecordSchema],
  remarks: String
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

studentFeeSchema.virtual('balanceDue').get(function() {
  return (this.totalAmount || 0) + (this.fine || 0) - (this.paidAmount || 0) - (this.discount || 0) - (this.scholarship || 0);
});

studentFeeSchema.index({ student: 1, academicYear: 1 });

module.exports = mongoose.model('StudentFee', studentFeeSchema);
