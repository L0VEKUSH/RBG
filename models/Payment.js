const mongoose = require('mongoose');
const crypto = require('crypto');

const paymentSchema = new mongoose.Schema({
  studentFee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudentFee',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  method: {
    type: String,
    enum: ['Cash', 'Cheque', 'Online', 'BankTransfer'],
    required: true
  },
  receiptNumber: {
    type: String,
    unique: true
  },
  idempotencyKey: {
    type: String,
    required: true,
    trim: true,
    select: false
  },
  date: {
    type: Date,
    default: Date.now
  },
  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  remarks: String,
  academicYear: String
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

paymentSchema.pre('save', function() {
  if (this.isNew && !this.receiptNumber) {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    this.receiptNumber = `REC-${dateStr}-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
  }
});

paymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Payment', paymentSchema);
