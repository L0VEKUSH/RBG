const mongoose = require('mongoose');

const NoticeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Notice title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    content: {
      type: String,
      required: [true, 'Notice content is required'],
    },
    type: {
      type: String,
      enum: ['General', 'Academic', 'Event', 'Holiday', 'Exam', 'Fee', 'Emergency', 'Sports', 'Result'],
      default: 'General',
    },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Urgent'],
      default: 'Medium',
    },
    targetAudience: {
      type: [String],
      enum: ['All', 'Students', 'Faculty', 'Parents', 'Admin'],
      default: ['All'],
    },
    targetClasses: {
      type: [String],
      enum: ['All', 'Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1','2','3','4','5','6','7','8','9','10','11','12'],
      default: ['All'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    publishDate: {
      type: Date,
      default: Date.now,
    },
    expiryDate: {
      type: Date,
    },
    attachments: [
      {
        name: String,
        url: String,
        type: String,
      },
    ],
    isPublished: {
      type: Boolean,
      default: true,
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
    views: {
      type: Number,
      default: 0,
    },
    viewedBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        viewedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: isExpired
NoticeSchema.virtual('isExpired').get(function () {
  if (!this.expiryDate) return false;
  return this.expiryDate < new Date();
});

// Index for efficient queries
NoticeSchema.index({ publishDate: -1, isPublished: 1 });
NoticeSchema.index({ isPinned: -1, publishDate: -1 });

module.exports = mongoose.model('Notice', NoticeSchema);
