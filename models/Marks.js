const mongoose = require('mongoose');

const CLASS_LEVELS = [
  'Pre-Nursery', 'Nursery', 'LKG', 'UKG',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
];

const SubjectMarkSchema = new mongoose.Schema({
  subject: { type: String, required: true },
  maxMarks: { type: Number, required: true, default: 100 },
  marksObtained: { type: Number, required: true, min: 0 },
  grade: String,
  gradePoint: Number,
  remarks: String,
  isAbsent: { type: Boolean, default: false },
});

const MarksSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: [true, 'Student is required'],
    },
    class: {
      type: String,
      required: [true, 'Class is required'],
      enum: CLASS_LEVELS,
    },
    academicYear: {
      type: String,
      required: [true, 'Academic year is required'],
    },
    examType: {
      type: String,
      required: [true, 'Exam type is required'],
      enum: [
        'Unit Test 1', 'Unit Test 2', 'Unit Test 3', 'Unit Test 4',
        'Half Yearly', 'Pre-Board', 'Annual', 'Practical',
        'Internal Assessment', 'Class Test', 'Periodic Test',
      ],
    },
    examDate: {
      type: Date,
    },
    subjects: [SubjectMarkSchema],
    totalMarks: { type: Number, default: 0 },
    obtainedMarks: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    overallGrade: String,
    cgpa: { type: Number, default: 0 },
    rank: Number,
    result: {
      type: String,
      enum: ['Pass', 'Fail', 'Compartment', 'Promoted', 'Detained', 'Pending'],
      default: 'Pending',
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    publishedAt: Date,
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    remarks: String,
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Unique marks per student per exam per year
MarksSchema.index({ student: 1, examType: 1, academicYear: 1 }, { unique: true });
MarksSchema.index({ class: 1, examType: 1, academicYear: 1 });

// Pre-save: compute grades and totals (do this in parent hook to avoid subdocument hook issues)
MarksSchema.pre('save', function (next) {
  if (this.subjects && this.subjects.length > 0) {
    // Calculate grades for each subject inline (avoids subdocument pre-save hook issues)
    this.subjects.forEach(s => {
      if (!s.isAbsent && s.marksObtained !== undefined) {
        const pct = (s.marksObtained / s.maxMarks) * 100;
        if (pct >= 90) { s.grade = 'A1'; s.gradePoint = 10; }
        else if (pct >= 80) { s.grade = 'A2'; s.gradePoint = 9; }
        else if (pct >= 70) { s.grade = 'B1'; s.gradePoint = 8; }
        else if (pct >= 60) { s.grade = 'B2'; s.gradePoint = 7; }
        else if (pct >= 50) { s.grade = 'C1'; s.gradePoint = 6; }
        else if (pct >= 40) { s.grade = 'C2'; s.gradePoint = 5; }
        else if (pct >= 33) { s.grade = 'D'; s.gradePoint = 4; }
        else { s.grade = 'E (Fail)'; s.gradePoint = 0; }
      } else if (s.isAbsent) {
        s.grade = 'AB';
        s.gradePoint = 0;
        s.marksObtained = 0;
      }
    });

    this.totalMarks = this.subjects.reduce((acc, s) => acc + s.maxMarks, 0);
    this.obtainedMarks = this.subjects.reduce((acc, s) => acc + (s.isAbsent ? 0 : s.marksObtained), 0);
    this.percentage = this.totalMarks > 0 ? parseFloat(((this.obtainedMarks / this.totalMarks) * 100).toFixed(2)) : 0;
    
    const validSubjects = this.subjects.filter(s => !s.isAbsent);
    const avgGP = validSubjects.length > 0
      ? validSubjects.reduce((acc, s) => acc + (s.gradePoint || 0), 0) / validSubjects.length
      : 0;
    this.cgpa = parseFloat(avgGP.toFixed(2));

    // Overall grade
    const pct = this.percentage;
    if (pct >= 90) this.overallGrade = 'A1';
    else if (pct >= 80) this.overallGrade = 'A2';
    else if (pct >= 70) this.overallGrade = 'B1';
    else if (pct >= 60) this.overallGrade = 'B2';
    else if (pct >= 50) this.overallGrade = 'C1';
    else if (pct >= 40) this.overallGrade = 'C2';
    else if (pct >= 33) this.overallGrade = 'D';
    else this.overallGrade = 'E';

    // Result - handle absent students correctly
    const hasFail = this.subjects.some(s => (s.gradePoint === 0 && !s.isAbsent) || s.isAbsent);
    if (this.subjects.every(s => s.isAbsent)) {
      this.result = 'Fail';
    } else if (hasFail) {
      this.result = 'Fail';
    } else {
      this.result = 'Pass';
    }
  }
  next();
});

module.exports = mongoose.model('Marks', MarksSchema);
