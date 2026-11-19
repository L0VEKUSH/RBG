const mongoose = require('mongoose');

// Exactly 15 approved logical school class levels:
// 1. Nursery / NC, 2. KG-1 (LKG), 3. KG-2 (UKG), 4-15. Classes 1 to 12
const CANONICAL_CLASS_LEVELS = [
  'Nursery', 'LKG', 'UKG',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
];

// Preserved for backward read compatibility with legacy enums
const CLASS_LEVELS = [
  'Pre-Nursery', 'Nursery', 'LKG', 'UKG',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
];

const CLASS_ALIAS_MAP = {
  'nursery': 'Nursery',
  'nc': 'Nursery',
  'nursery / nc': 'Nursery',
  'nursery/nc': 'Nursery',
  'kg-1': 'LKG',
  'kg1': 'LKG',
  'kg 1': 'LKG',
  'lkg': 'LKG',
  'kg-2': 'UKG',
  'kg2': 'UKG',
  'kg 2': 'UKG',
  'ukg': 'UKG',
};
for (let i = 1; i <= 12; i++) {
  CLASS_ALIAS_MAP[`class ${i}`] = String(i);
  CLASS_ALIAS_MAP[`class-${i}`] = String(i);
  CLASS_ALIAS_MAP[`${i}`] = String(i);
}

function normalizeClassLevel(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return CLASS_ALIAS_MAP[normalized] || null;
}

function validateAndNormalizeClassWrite(value, fieldName = 'class') {
  if (value === undefined || value === null) {
    const err = new Error(`${fieldName} is required`);
    err.statusCode = 400;
    throw err;
  }
  if (typeof value !== 'string') {
    const err = new Error(`Invalid ${fieldName} value`);
    err.statusCode = 400;
    throw err;
  }
  const trimmed = value.trim();
  if (/^pre[- ]?nursery$/i.test(trimmed)) {
    const err = new Error("'Pre-Nursery' is not an approved school class level. Approved structure has 15 classes starting from Nursery / NC.");
    err.statusCode = 400;
    throw err;
  }
  if (/^(?:class[- ]?)?(?:nursery|nc|lkg|ukg|kg[- ]?[12]|\d{1,2})[- ]?[a-z]$/i.test(trimmed)) {
    const err = new Error('Class sections are not supported. RBG School ERP models single undivided classes per level.');
    err.statusCode = 400;
    throw err;
  }
  const canonical = normalizeClassLevel(trimmed);
  if (!canonical || !CANONICAL_CLASS_LEVELS.includes(canonical)) {
    const err = new Error(`Class '${value}' is not one of the approved 15 school class levels.`);
    err.statusCode = 400;
    throw err;
  }
  return canonical;
}

const classSchema = new mongoose.Schema({
  name: {
    type: String,
    enum: CLASS_LEVELS,
    required: true
  },
  classTeacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Faculty'
  },
  academicYear: {
    type: String,
    required: true
  },
  academicLevel: {
    type: String,
    enum: ['Pre-Primary', 'Primary', 'Middle', 'Secondary', 'Senior Secondary'],
    required: true
  },
  displayOrder: {
    type: Number,
    required: true
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

classSchema.virtual('section').set(function () {
  this.invalidate('section', 'Class sections are not supported. RBG School ERP models single undivided classes per level.');
});
classSchema.virtual('sections').set(function () {
  this.invalidate('sections', 'Class sections are not supported. RBG School ERP models single undivided classes per level.');
});

// Pre-validate hook enforcing the 15 approved logical classes and alias normalization
classSchema.pre('validate', function (next) {
  if (this.section || this.sections) {
    this.invalidate('section', 'Class sections are not supported. RBG School ERP models single undivided classes per level.');
  }

  if (this.name) {
    try {
      this.name = validateAndNormalizeClassWrite(this.name, 'Class name');
    } catch (err) {
      this.invalidate('name', err.message);
      return next();
    }
  }

  if (!this.academicLevel && this.name) {
    if (['Nursery', 'LKG', 'UKG'].includes(this.name)) this.academicLevel = 'Pre-Primary';
    else if (['1', '2', '3', '4', '5'].includes(this.name)) this.academicLevel = 'Primary';
    else if (['6', '7', '8'].includes(this.name)) this.academicLevel = 'Middle';
    else if (['9', '10'].includes(this.name)) this.academicLevel = 'Secondary';
    else if (['11', '12'].includes(this.name)) this.academicLevel = 'Senior Secondary';
  }

  if (this.displayOrder === undefined && this.name) {
    this.displayOrder = CANONICAL_CLASS_LEVELS.indexOf(this.name);
  }

  next();
});

classSchema.index({ name: 1, academicYear: 1 }, { unique: true });

classSchema.statics.CANONICAL_CLASS_LEVELS = CANONICAL_CLASS_LEVELS;
classSchema.statics.CLASS_LEVELS = CLASS_LEVELS;
classSchema.statics.normalizeClassLevel = normalizeClassLevel;
classSchema.statics.validateAndNormalizeClassWrite = validateAndNormalizeClassWrite;

module.exports = mongoose.model('Class', classSchema);
