const mongoose = require('mongoose');

const CLASS_LEVELS = ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'All'];

const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  type: {
    type: String,
    enum: ['Academic', 'Sports', 'Cultural', 'ParentTeacher', 'Competition', 'Holiday', 'Trip', 'Workshop', 'Celebration', 'Other']
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: Date,
  venue: String,
  isPublic: {
    type: Boolean,
    default: true
  },
  targetAudience: [{
    type: String,
    enum: ['All', 'Students', 'Teachers', 'Parents', 'Staff']
  }],
  targetClasses: [{
    type: String,
    enum: CLASS_LEVELS
  }],
  attachments: [{
    name: String,
    url: String
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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

eventSchema.index({ startDate: 1 });
eventSchema.index({ type: 1 });

module.exports = mongoose.model('Event', eventSchema);
