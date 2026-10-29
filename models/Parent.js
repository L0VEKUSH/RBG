const mongoose = require('mongoose');

const parentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
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

parentSchema.methods.getChildren = async function() {
  await this.populate('children');
  return this.children;
};


module.exports = mongoose.model('Parent', parentSchema);
