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
    required: true,
    min: 1,
    validate: {
      validator(value) {
        if (!Number.isSafeInteger(value) || value < 1) return false;
        if (this instanceof mongoose.Query) {
          // Query validators cannot compare against an omitted persisted sibling.
          // Require paired $set values for service-mediated total changes. Operators
          // such as $inc remain protected by the transactional service instead.
          const updatedAvailable = this.get('availableCopies');
          return Number.isSafeInteger(updatedAvailable) && updatedAvailable >= 0 && updatedAvailable <= value;
        }
        return Number.isSafeInteger(this.availableCopies) && this.availableCopies >= 0 && this.availableCopies <= value;
      },
      message: 'Total copies must be a positive whole number',
    },
  },
  availableCopies: {
    type: Number,
    default() { return this.totalCopies; },
    min: 0,
    validate: {
      validator(value) {
        if (!Number.isSafeInteger(value)) return false;
        if (this instanceof mongoose.Query) {
          // Require paired $set values; the service also checks persisted inventory
          // and the loan ledger because query validation cannot read stored siblings.
          const updatedTotal = this.get('totalCopies');
          return Number.isSafeInteger(updatedTotal) && updatedTotal >= 1 && value <= updatedTotal;
        }
        return Number.isSafeInteger(this.totalCopies) && this.totalCopies >= 1 && value <= this.totalCopies;
      },
      message: 'Available copies must be a whole number no greater than total copies',
    },
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

libraryBookSchema.pre('validate', function validateNewBookInventory() {
  // A new title has no loans yet, so every copy must be available.
  if (this.isNew && this.availableCopies !== this.totalCopies) {
    this.invalidate('availableCopies', 'A new book must begin with all copies available');
  }
});

libraryBookSchema.index({ isbn: 1 });
libraryBookSchema.index({ title: 1 });

module.exports = mongoose.model('LibraryBook', libraryBookSchema);
