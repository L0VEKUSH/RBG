const mongoose = require('mongoose');

const libraryTransactionSchema = new mongoose.Schema({
  book: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LibraryBook',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  issuedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  issueDate: {
    type: Date,
    default: Date.now
  },
  dueDate: {
    type: Date,
    required: true
  },
  returnDate: Date,
  status: {
    type: String,
    enum: ['Issued', 'Returned', 'Overdue', 'Lost'],
    default: 'Issued'
  },
  fine: {
    type: Number,
    default: 0
  },
  fineStatus: {
    type: String,
    enum: ['Pending', 'Paid', 'Waived']
  },
  remarks: String
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

libraryTransactionSchema.index({ student: 1, status: 1 });
libraryTransactionSchema.index({ book: 1, status: 1 });

module.exports = mongoose.model('LibraryTransaction', libraryTransactionSchema);
