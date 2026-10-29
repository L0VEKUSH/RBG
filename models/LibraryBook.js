const mongoose = require('mongoose');

const libraryBookSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  author: {
    type: String,
    required: true,
    trim: true
  },
  isbn: {
    type: String,
    trim: true
  },
  category: {
    type: String,
    enum: ['Fiction', 'Non-Fiction', 'Science', 'Mathematics', 'History', 'Geography', 'Literature', 'Reference', 'Textbook', 'Biography', 'Other']
  },
  publisher: String,
  publicationYear: Number,
  totalCopies: {
    type: Number,
    default: 1
  },
  availableCopies: {
    type: Number,
    default: 1
  },
  location: String,
  description: String,
  coverImage: String,
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

libraryBookSchema.index({ isbn: 1 });
libraryBookSchema.index({ title: 1 });

module.exports = mongoose.model('LibraryBook', libraryBookSchema);
