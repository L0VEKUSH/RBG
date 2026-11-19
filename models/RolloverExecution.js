'use strict';

const mongoose = require('mongoose');

const decisionSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  action: {
    type: String,
    enum: ['pending', 'promote', 'continue', 'graduate', 'withdraw', 'transfer', 'leave_unchanged'],
    default: 'pending',
  },
  currentClass: { type: String, required: true },
  currentAcademicYear: { type: String, required: true },
  currentIsActive: { type: Boolean, required: true },
  currentTcIssued: { type: Boolean, required: true },
  effectiveDate: Date,
  note: { type: String, maxlength: 1000 },
  result: {
    type: String,
    enum: ['pending', 'applied', 'skipped', 'failed'],
    default: 'pending',
  },
  error: String,
}, { _id: false });

const rolloverExecutionSchema = new mongoose.Schema({
  sourceAcademicYear: { type: String, required: true },
  destinationAcademicYear: { type: String, required: true },
  status: {
    type: String,
    enum: ['draft', 'executing', 'completed', 'failed'],
    default: 'draft',
  },
  decisions: { type: [decisionSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  executedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  executedAt: Date,
  failureMessage: String,
  revision: { type: Number, default: 0 },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

rolloverExecutionSchema.index(
  { sourceAcademicYear: 1, destinationAcademicYear: 1 },
  { unique: true }
);

module.exports = mongoose.model('RolloverExecution', rolloverExecutionSchema);
