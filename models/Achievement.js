const mongoose = require('mongoose');

const achievementSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  category: {
    type: String,
    enum: ['Academic', 'Sports', 'Cultural', 'Science', 'Technology', 'Other']
  },
  level: {
    type: String,
    enum: ['School', 'District', 'State', 'National', 'International']
  },
  date: Date,
  position: String,
  certificate: String,
  awardedBy: String,
  isPublic: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

achievementSchema.index({ student: 1 });

module.exports = mongoose.model('Achievement', achievementSchema);
