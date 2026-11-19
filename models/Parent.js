const mongoose = require('mongoose');

const admissionSagaLinkSchema = new mongoose.Schema({
  sagaId: { type: String, required: true },
  ownerGeneration: { type: Number, required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Student' },
}, { _id: false });

const parentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  admissionSagaId: { type: String, select: false },
  admissionSagaGeneration: { type: Number, select: false },
  admissionSagaOwnership: { type: String, enum: ['owned', 'shared'], select: false },
  admissionSagaLinks: { type: [admissionSagaLinkSchema], default: [], select: false },
  children: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  }],
  occupation: {
    type: String,
    trim: true
  },
  workAddress: {
    type: String,
    trim: true
  },
  relationship: {
    type: String,
    enum: ['Father', 'Mother', 'Guardian'],
    required: true
  },
  emergencyPhone: {
    type: String,
    trim: true
  },
  alternatePhone: {
    type: String,
    trim: true
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

parentSchema.index({ admissionSagaId: 1, admissionSagaGeneration: 1 }, { sparse: true });
parentSchema.index({ 'admissionSagaLinks.sagaId': 1, 'admissionSagaLinks.ownerGeneration': 1 });

parentSchema.methods.getChildren = async function() {
  await this.populate('children');
  return this.children;
};


module.exports = mongoose.model('Parent', parentSchema);
