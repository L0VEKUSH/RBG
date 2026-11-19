const mongoose = require('mongoose');
const Class = require('./Class');

const CLASS_LEVELS = [
  'Pre-Nursery', 'Nursery', 'LKG', 'UKG',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
];

const FacultySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    employeeId: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      enum: [
        'Mathematics', 'Science', 'English', 'Hindi', 'Social Science',
        'Physical Education', 'Arts', 'Music', 'Computer Science',
        'Physics', 'Chemistry', 'Biology', 'Commerce', 'Economics',
        'Sanskrit', 'French', 'General', 'Early Childhood',
        'Administration', 'Library', 'Transport', 'Accounts', 'Health',
      ],
    },
    designation: {
      type: String,
      required: [true, 'Designation is required'],
      enum: [
        'Principal', 'Vice Principal', 'HOD', 'Senior Teacher',
        'Teacher', 'PRT', 'TGT', 'PGT',
        'Lab Assistant', 'Librarian',
        'Counselor', 'Sports Coach', 'Administrative Staff',
        'Coordinator', 'Accountant', 'Nurse', 'Driver', 'Attendant',
        'Receptionist', 'HR Manager', 'IT Support',
      ],
    },
    subjects: [
      {
        subject: { type: String, required: true },
        classes: [{ type: String, enum: CLASS_LEVELS }],
      },
    ],
    classTeacherOf: {
      class: { type: String, enum: [...CLASS_LEVELS, ''] },
      academicYear: String,
    },
    qualification: [
      {
        degree: { type: String, required: true },
        institution: String,
        year: Number,
        percentage: Number,
      },
    ],
    experience: {
      total: { type: Number, default: 0 },
      current: { type: Number, default: 0 },
    },
    joiningDate: {
      type: Date,
      required: [true, 'Joining date is required'],
    },
    salary: {
      basic: Number,
      hra: Number,
      da: Number,
      allowances: Number,
      deductions: Number,
    },
    bankDetails: {
      accountNumber: String,
      bankName: String,
      ifscCode: String,
      accountHolder: String,
    },
    emergencyContact: {
      name: String,
      relation: String,
      phone: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isClassTeacher: {
      type: Boolean,
      default: false,
    },
    leaves: [
      {
        type: { type: String, enum: ['Sick', 'Casual', 'Earned', 'Maternity', 'Paternity', 'Other'] },
        from: Date,
        to: Date,
        reason: String,
        status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        appliedOn: { type: Date, default: Date.now },
      },
    ],
    documents: [
      {
        name: String,
        url: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: total salary
FacultySchema.virtual('totalSalary').get(function () {
  if (!this.salary) return 0;
  const { basic = 0, hra = 0, da = 0, allowances = 0, deductions = 0 } = this.salary;
  return basic + hra + da + allowances - deductions;
});

FacultySchema.virtual('section').set(function () {
  this.invalidate('section', 'Class sections are not supported. RBG School ERP models single undivided classes per level.');
});
FacultySchema.virtual('sections').set(function () {
  this.invalidate('sections', 'Class sections are not supported. RBG School ERP models single undivided classes per level.');
});

// Pre-validate hook enforcing canonical classes, alias normalization, and no sections
FacultySchema.pre('validate', function (next) {
  if (this.section || this.sections) {
    this.invalidate('section', 'Class sections are not supported. RBG School ERP models single undivided classes per level.');
  }

  if (this.isModified('classTeacherOf') || this.isNew) {
    if (this.classTeacherOf && this.classTeacherOf.class) {
      try {
        this.classTeacherOf.class = Class.validateAndNormalizeClassWrite(this.classTeacherOf.class, 'classTeacherOf.class');
      } catch (err) {
        this.invalidate('classTeacherOf.class', err.message);
        return next();
      }
    }
  }

  if (this.isModified('subjects') || this.isNew) {
    if (Array.isArray(this.subjects)) {
      for (const sub of this.subjects) {
        if (Array.isArray(sub.classes)) {
          const normalized = [];
          for (const cls of sub.classes) {
            try {
              normalized.push(Class.validateAndNormalizeClassWrite(cls, 'subject class'));
            } catch (err) {
              this.invalidate('subjects', err.message);
              return next();
            }
          }
          sub.classes = normalized;
        }
      }
    }
  }

  next();
});

// Auto generate employee ID
FacultySchema.pre('save', async function (next) {
  if (this.isNew && !this.employeeId) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments();
    this.employeeId = `EMP${year}${String(count + 1).padStart(3, '0')}`;
  }
  next();
});

FacultySchema.index({ department: 1 });
FacultySchema.index({ 'classTeacherOf.class': 1 });

FacultySchema.statics.CLASS_LEVELS = CLASS_LEVELS;
FacultySchema.statics.CANONICAL_CLASS_LEVELS = Class.CANONICAL_CLASS_LEVELS;

module.exports = mongoose.model('Faculty', FacultySchema);
