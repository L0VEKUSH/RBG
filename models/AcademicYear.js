const mongoose = require('mongoose');
const { isValidAcademicYear } = require('../utils/academic-year');
const { schoolDateKey } = require('../utils/attendance-date');

const termSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  }
});

const academicYearSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  startDate: {
    type: Date,
    required: true,
    cast: 'Academic year start date must be a valid date.'
  },
  endDate: {
    type: Date,
    required: true,
    cast: 'Academic year end date must be a valid date.'
  },
  terms: [termSchema],
  isCurrent: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

academicYearSchema.index(
  { isCurrent: 1 },
  {
    unique: true,
    partialFilterExpression: { isCurrent: true },
    background: true
  }
);

academicYearSchema.pre('validate', async function validateAcademicYear(next) {
  if (!isValidAcademicYear(this.name)) {
    this.invalidate('name', 'Academic year must use consecutive YYYY-YYYY format.');
  }

  const startDate = this.startDate;
  const endDate = this.endDate;
  const hasValidStartDate = startDate instanceof Date && !Number.isNaN(startDate.getTime());
  const hasValidEndDate = endDate instanceof Date && !Number.isNaN(endDate.getTime());

  if (!hasValidStartDate) {
    this.invalidate('startDate', 'Academic year start date must be a valid date.');
  }
  if (!hasValidEndDate) {
    this.invalidate('endDate', 'Academic year end date must be a valid date.');
  }

  if (!hasValidStartDate || !hasValidEndDate) return next();

  let startDateKey;
  let endDateKey;
  try {
    startDateKey = schoolDateKey(startDate);
    endDateKey = schoolDateKey(endDate);
  } catch (error) {
    this.invalidate('startDate', 'Academic year dates must be valid school dates.');
    this.invalidate('endDate', 'Academic year dates must be valid school dates.');
    return next();
  }

  if (startDateKey >= endDateKey) {
    this.invalidate('startDate', 'Academic year start date must be earlier than its end date.');
    this.invalidate('endDate', 'Academic year end date must be later than its start date.');
  }

  if (this.isActive !== true || startDateKey >= endDateKey) return next();

  const filter = {
    isActive: true,
  };
  if (!this.isNew && this._id) filter._id = { $ne: this._id };

  let overlappingYears;
  try {
    overlappingYears = await this.constructor.find(filter).select('name startDate endDate').lean();
  } catch (error) {
    return next(error);
  }

  const overlaps = overlappingYears.some((year) => {
    try {
      const otherStart = schoolDateKey(year.startDate);
      const otherEnd = schoolDateKey(year.endDate);
      return startDateKey <= otherEnd && endDateKey >= otherStart;
    } catch (error) {
      return false;
    }
  });

  if (overlaps) {
    this.invalidate('startDate', 'Active academic year dates overlap another active academic year.');
    this.invalidate('endDate', 'Active academic year dates overlap another active academic year.');
  }

  next();
});

academicYearSchema.statics.getCurrent = async function() {
  return await this.findOne({ isCurrent: true, isActive: true });
};

module.exports = mongoose.model('AcademicYear', academicYearSchema);
