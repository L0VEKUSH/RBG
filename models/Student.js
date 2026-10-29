const mongoose = require('mongoose');

const CLASS_LEVELS = [
  'Pre-Nursery', 'Nursery', 'LKG', 'UKG',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
];

const StudentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    admissionNumber: {
      type: String,
      unique: true,
      uppercase: true,
      trim: true,
    },
    rollNumber: {
      type: Number,
      required: [true, 'Roll number is required'],
    },
    class: {
      type: String,
      required: [true, 'Class is required'],
      enum: CLASS_LEVELS,
    },
    stream: {
      type: String,
      enum: ['Science', 'Commerce', 'Humanities', 'N/A'],
      default: 'N/A',
    },
    house: {
      type: String,
      enum: ['Red', 'Blue', 'Green', 'Yellow', ''],
      default: '',
    },
    admissionDate: {
      type: Date,
      required: [true, 'Admission date is required'],
      default: Date.now,
    },
    academicYear: {
      type: String,
      required: [true, 'Academic year is required'],
      match: [/^\d{4}-\d{4}$/, 'Format: 2024-2025'],
    },
    father: {
      name: { type: String, required: [true, "Father's name is required"] },
      occupation: String,
      phone: String,
      email: String,
    },
    mother: {
      name: { type: String, required: [true, "Mother's name is required"] },
      occupation: String,
      phone: String,
      email: String,
    },
    guardian: {
      name: String,
      relation: String,
      phone: String,
      email: String,
    },
    previousSchool: {
      name: String,
      address: String,
      tcNumber: String,
    },
    bloodGroup: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', ''],
    },
    medicalConditions: [String],
    categoryReservation: {
      type: String,
      enum: ['General', 'OBC', 'SC', 'ST', 'EWS'],
      default: 'General',
    },
    religion: String,
    nationality: {
      type: String,
      default: 'Indian',
    },
    fees: {
      totalFees: { type: Number, default: 0 },
      paidFees: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      feeStructure: String,
    },
    documents: [
      {
        name: String,
        url: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    parentUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    tcIssued: {
      type: Boolean,
      default: false,
    },
    tcDate: Date,
    remarks: String,
    enrollmentHistory: [
      {
        class: String,
        academicYear: String,
        stream: String,
        rollNumber: Number,
        promotedDate: { type: Date, default: Date.now }
      }
    ]
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: due fees
StudentSchema.virtual('dueFees').get(function () {
  return (this.fees.totalFees - this.fees.paidFees - this.fees.discount);
});

// FIXED: Compound index now includes class to prevent roll number collision across classes
StudentSchema.index({ class: 1, rollNumber: 1, academicYear: 1 }, { unique: true });
StudentSchema.index({ parentUser: 1 });

// Auto-generate admission number
StudentSchema.pre('save', async function (next) {
  if (this.isNew && !this.admissionNumber) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments();
    this.admissionNumber = `ADM${year}${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

// Statics
StudentSchema.statics.CLASS_LEVELS = CLASS_LEVELS;

module.exports = mongoose.model('Student', StudentSchema);
