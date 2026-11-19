const mongoose = require('mongoose');
const Class = require('./Class');

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

const admissionSagaResourcesSchema = new mongoose.Schema({
  studentUserId: mongoose.Schema.Types.ObjectId,
  studentId: mongoose.Schema.Types.ObjectId,
  studentFeeId: mongoose.Schema.Types.ObjectId,
  parentUserCandidateId: mongoose.Schema.Types.ObjectId,
  parentUserId: mongoose.Schema.Types.ObjectId,
  parentUserCreated: { type: Boolean, default: false },
  parentProfileCandidateId: mongoose.Schema.Types.ObjectId,
  parentProfileId: mongoose.Schema.Types.ObjectId,
  parentProfileCreated: { type: Boolean, default: false },
}, { _id: false });

const admissionSagaTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  tokenHash: { type: String, required: true },
  generation: Number,
}, { _id: false });

const admissionSagaLinkSchema = new mongoose.Schema({
  parentId: mongoose.Schema.Types.ObjectId,
  studentId: mongoose.Schema.Types.ObjectId,
  generation: Number,
  state: { type: String, enum: ['planned', 'applied', 'removed'] },
}, { _id: false });

const admissionSagaSchema = new mongoose.Schema({
  id: String,
  state: { type: String, enum: ['preparing', 'committed', 'compensating', 'rolled_back', 'manual_review'] },
  ownerId: String,
  ownerGeneration: Number,
  leaseUntil: Date,
  startedAt: Date,
  updatedAt: Date,
  committedAt: Date,
  commitMarker: String,
  step: String,
  attempts: { type: Number, default: 0 },
  lastErrorCode: String,
  resources: admissionSagaResourcesSchema,
  parentLink: admissionSagaLinkSchema,
  activationTokens: [admissionSagaTokenSchema],
}, { _id: false });

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
    enum: ['Draft', 'Submitted', 'Under_Review', 'Document_Verification', 'Approved', 'Admitting', 'Rejected', 'Waitlisted', 'Admitted'],
    default: 'Draft'
  },
  enrollmentEffectiveFrom: Date,
  enrollmentAcademicYear: String,
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
  },
  admissionSaga: admissionSagaSchema
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

admissionSchema.virtual('section').set(function () {
  this.invalidate('section', 'Class sections are not supported. RBG School ERP models single undivided classes per level.');
});
admissionSchema.virtual('sections').set(function () {
  this.invalidate('sections', 'Class sections are not supported. RBG School ERP models single undivided classes per level.');
});

admissionSchema.pre('validate', function(next) {
  if (this.section || this.sections) {
    this.invalidate('section', 'Class sections are not supported. RBG School ERP models single undivided classes per level.');
  }

  if (this.isNew || this.isModified('classApplyingFor')) {
    if (this.classApplyingFor) {
      try {
        this.classApplyingFor = Class.validateAndNormalizeClassWrite(this.classApplyingFor, 'classApplyingFor');
      } catch (err) {
        this.invalidate('classApplyingFor', err.message);
        return next();
      }
    }
  }

  next();
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
admissionSchema.index({ status: 1, 'admissionSaga.state': 1, 'admissionSaga.leaseUntil': 1 });

admissionSchema.statics.CLASS_LEVELS = CLASS_LEVELS;
admissionSchema.statics.CANONICAL_CLASS_LEVELS = Class.CANONICAL_CLASS_LEVELS;

module.exports = mongoose.model('Admission', admissionSchema);
