const mongoose = require('mongoose');

const CLASS_LEVELS = ['Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

const documentSchema = new mongoose.Schema({
  name: String,
  url: String,
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

const siblingSchema = new mongoose.Schema({
  name: String,
  class: String,
  admissionNumber: String
});

const admissionSchema = new mongoose.Schema({
  applicationNumber: {
    type: String,
    unique: true
  },
  studentName: {
    type: String,
    required: true,
    trim: true
  },
  dateOfBirth: {
    type: Date,
    required: true
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other']
  },
  classApplyingFor: {
    type: String,
    enum: CLASS_LEVELS
  },
  stream: String,
  fatherName: String,
  fatherOccupation: String,
  fatherPhone: String,
  fatherEmail: String,
  motherName: String,
  motherOccupation: String,
  motherPhone: String,
  motherEmail: String,
  guardianName: String,
  guardianRelation: String,
  guardianPhone: String,
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String
  },
  previousSchool: {
    name: String,
    address: String,
    class: String,
    percentage: Number
  },
  documents: [documentSchema],
  photo: String,
  transportRequired: Boolean,
  siblingInfo: [siblingSchema],
  status: {
    type: String,
    enum: ['Draft', 'Submitted', 'Under_Review', 'Document_Verification', 'Approved', 'Rejected', 'Waitlisted', 'Admitted'],
    default: 'Draft'
  },
  appliedDate: {
    type: Date,
    default: Date.now
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewDate: Date,
  remarks: String,
  interviewDate: Date,
  interviewRemarks: String,
  createdStudent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

admissionSchema.pre('save', async function(next) {
  if (this.isNew && !this.applicationNumber) {
    const count = await mongoose.model('Admission').countDocuments();
    const year = new Date().getFullYear();
    this.applicationNumber = `APP-${year}-${(count + 1).toString().padStart(4, '0')}`;
  }
  next();
});

admissionSchema.index({ status: 1 });

module.exports = mongoose.model('Admission', admissionSchema);
