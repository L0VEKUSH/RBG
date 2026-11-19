'use strict';

const mongoose = require('mongoose');

const resourcesSchema = new mongoose.Schema({
  studentUserId: mongoose.Schema.Types.ObjectId,
  studentId: mongoose.Schema.Types.ObjectId,
  studentFeeId: mongoose.Schema.Types.ObjectId,
  parentUserCandidateId: mongoose.Schema.Types.ObjectId,
  parentUserId: mongoose.Schema.Types.ObjectId,
  parentUserCreated: { type: Boolean, default: false },
  parentProfileCandidateId: mongoose.Schema.Types.ObjectId,
  parentProfileId: mongoose.Schema.Types.ObjectId,
  parentProfileCreated: { type: Boolean, default: false },
  parentLink: {
    parentId: mongoose.Schema.Types.ObjectId,
    studentId: mongoose.Schema.Types.ObjectId,
    generation: Number,
    state: { type: String, enum: ['planned', 'applied', 'removed'] },
  },
}, { _id: false });

const tokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  tokenHash: { type: String, required: true },
  generation: { type: Number, required: true },
}, { _id: false });

const AdmissionSagaAttemptSchema = new mongoose.Schema({
  sagaId: { type: String, required: true, unique: true },
  admission: { type: mongoose.Schema.Types.ObjectId, ref: 'Admission', required: true },
  enrollmentEffectiveFrom: { type: Date, required: true },
  enrollmentAcademicYear: { type: String, required: true },
  ownerId: String,
  ownerGeneration: { type: Number, required: true, default: 1 },
  state: {
    type: String,
    enum: ['preparing', 'committed', 'compensating', 'rolled_back', 'manual_review'],
    required: true,
  },
  leaseUntil: Date,
  startedAt: Date,
  updatedAt: Date,
  committedAt: Date,
  admissionFinalizedAt: Date,
  commitMarker: String,
  committedStudentId: mongoose.Schema.Types.ObjectId,
  step: String,
  attempts: { type: Number, default: 0 },
  lastErrorCode: String,
  nextCleanupAt: Date,
  resources: { type: resourcesSchema, required: true },
  activationTokens: [tokenSchema],
}, { timestamps: true });

AdmissionSagaAttemptSchema.index({ state: 1, leaseUntil: 1, _id: 1 });
AdmissionSagaAttemptSchema.index({ state: 1, nextCleanupAt: 1, _id: 1 });
AdmissionSagaAttemptSchema.index({ admission: 1, ownerGeneration: 1 });

module.exports = mongoose.model('AdmissionSagaAttempt', AdmissionSagaAttemptSchema);
