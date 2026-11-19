'use strict';

const mongoose = require('mongoose');

const WorkerLeaseSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  ownerId: { type: String },
  leaseUntil: { type: Date },
  generation: { type: Number, default: 1 },
  state: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
  completedAt: { type: Date },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('WorkerLease', WorkerLeaseSchema);
