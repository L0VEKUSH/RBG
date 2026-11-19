const mongoose = require('mongoose');

const EmailDeliverySchema = new mongoose.Schema({
  type: { type: String, enum: ['password_reset', 'activation'], required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  relatedAdmission: { type: mongoose.Schema.Types.ObjectId, ref: 'Admission' },
  admissionSagaId: String,
  admissionSagaGeneration: Number,
  recipient: { type: String, required: true },
  idempotencyKey: { type: String, required: true, unique: true },
  encryptedToken: {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    keyVersion: { type: String, required: true },
    aadVersion: Number,
  },
  tokenExpiresAt: { type: Date, required: true },
  status: {
    type: String,
    enum: ['staged', 'pending', 'processing', 'sent', 'failed', 'dead_letter', 'expired'],
    default: 'pending',
    index: true,
  },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockedAt: Date,
  leaseUntil: Date,
  lockToken: String,
  lastEnqueuedAt: Date,
  purgeAt: Date,
  lastErrorCode: String,
  providerMessageId: String,
  sentAt: Date,
}, { timestamps: true });

EmailDeliverySchema.index({ status: 1, nextAttemptAt: 1 });
EmailDeliverySchema.index({ status: 1, lockedAt: 1 });
EmailDeliverySchema.index({ status: 1, lastEnqueuedAt: 1, nextAttemptAt: 1 });
EmailDeliverySchema.index({ admissionSagaId: 1, admissionSagaGeneration: 1, status: 1 });
EmailDeliverySchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('EmailDelivery', EmailDeliverySchema);
