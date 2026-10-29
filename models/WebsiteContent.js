const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  url: String,
  caption: String,
  order: Number
});

const websiteContentSchema = new mongoose.Schema({
  page: {
    type: String,
    required: true,
    trim: true
  },
  pageBlock: {
    type: String,
    required: true,
    trim: true
  },
  title: String,
  content: String,
  images: [imageSchema],
  order: {
    type: Number,
    default: 0
  },
  isPublished: {
    type: Boolean,
    default: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

websiteContentSchema.index({ page: 1, pageBlock: 1 }, { unique: true });

module.exports = mongoose.model('WebsiteContent', websiteContentSchema);
