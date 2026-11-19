'use strict';

/**
 * Exactly 15 approved logical school class levels:
 *  1. Nursery / NC
 *  2. KG-1 (stored canonically as 'LKG')
 *  3. KG-2 (stored canonically as 'UKG')
 *  4–15. Classes 1 to 12 (stored canonically as '1' through '12')
 *
 * NOTE: 'Pre-Nursery' is explicitly NOT included in the approved 15-class structure.
 */
const CANONICAL_CLASS_LEVELS = [
  'Nursery', 'LKG', 'UKG',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
];

const CLASS_LEVEL_LABELS = {
  'Nursery': 'Nursery / NC',
  'LKG': 'KG-1',
  'UKG': 'KG-2',
  '1': 'Class 1',
  '2': 'Class 2',
  '3': 'Class 3',
  '4': 'Class 4',
  '5': 'Class 5',
  '6': 'Class 6',
  '7': 'Class 7',
  '8': 'Class 8',
  '9': 'Class 9',
  '10': 'Class 10',
  '11': 'Class 11',
  '12': 'Class 12',
};

// Aliases mapping to canonical database stored values
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

function resolveCanonicalClassLevel(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return CLASS_ALIAS_MAP[normalized] || null;
}

const VALID_ACADEMIC_LEVELS = ['Pre-Primary', 'Primary', 'Middle', 'Secondary', 'Senior Secondary'];
const VALID_SUBJECT_TYPES = ['Core', 'Elective', 'Language', 'Co-Curricular'];

function getExpectedAcademicLevel(className) {
  const canonical = resolveCanonicalClassLevel(className) || className;
  if (['Nursery', 'LKG', 'UKG'].includes(canonical)) return 'Pre-Primary';
  if (['1', '2', '3', '4', '5'].includes(canonical)) return 'Primary';
  if (['6', '7', '8'].includes(canonical)) return 'Middle';
  if (['9', '10'].includes(canonical)) return 'Secondary';
  if (['11', '12'].includes(canonical)) return 'Senior Secondary';
  return null;
}

/**
 * Validate AcademicYear records.
 */
async function validateAcademicYears(AcademicYearModel) {
  const issues = [];
  const years = await AcademicYearModel.find();

  if (years.length === 0) {
    issues.push({
      severity: 'ERROR',
      entity: 'AcademicYear',
      code: 'NO_ACADEMIC_YEARS',
      message: 'No academic years exist in the database.',
    });
    return { issues, activeYear: null, count: 0 };
  }

  const currentYears = years.filter((y) => y.isCurrent && y.isActive);
  if (currentYears.length === 0) {
    issues.push({
      severity: 'ERROR',
      entity: 'AcademicYear',
      code: 'NO_ACTIVE_CURRENT_YEAR',
      message: 'No academic year is marked as current and active.',
    });
  } else if (currentYears.length > 1) {
    issues.push({
      severity: 'ERROR',
      entity: 'AcademicYear',
      code: 'MULTIPLE_CURRENT_YEARS',
      message: `Multiple academic years (${currentYears.map((y) => y.name).join(', ')}) are marked as current. Exactly one must be current.`,
    });
  }

  const activeYear = currentYears.length === 1 ? currentYears[0] : null;

  // Validate each year's boundaries and terms
  const seenNames = new Set();
  for (const year of years) {
    if (seenNames.has(year.name)) {
      issues.push({
        severity: 'ERROR',
        entity: 'AcademicYear',
        code: 'DUPLICATE_ACADEMIC_YEAR_NAME',
        message: `Duplicate academic year name '${year.name}' detected.`,
      });
    }
    seenNames.add(year.name);

    const match = /^(\d{4})-(\d{4})$/.exec(year.name || '');
    if (!match || Number(match[2]) !== Number(match[1]) + 1) {
      issues.push({
        severity: 'ERROR',
        entity: 'AcademicYear',
        code: 'INVALID_YEAR_NAME_FORMAT',
        message: `Academic year name '${year.name}' must follow consecutive YYYY-YYYY format (e.g. 2026-2027).`,
      });
    }

    if (!year.startDate || !year.endDate || new Date(year.startDate) >= new Date(year.endDate)) {
      issues.push({
        severity: 'ERROR',
        entity: 'AcademicYear',
        code: 'INVALID_YEAR_BOUNDARIES',
        message: `Academic year '${year.name}' has invalid boundaries: startDate must be strictly before endDate.`,
      });
    }

    // Check terms if present
    if (Array.isArray(year.terms) && year.terms.length > 0) {
      for (const term of year.terms) {
        if (!term.name || !term.startDate || !term.endDate || new Date(term.startDate) >= new Date(term.endDate)) {
          issues.push({
            severity: 'ERROR',
            entity: 'AcademicYear',
            code: 'INVALID_TERM_BOUNDARIES',
            message: `Term '${term.name}' in academic year '${year.name}' has invalid boundaries (startDate >= endDate).`,
          });
        }
        if (new Date(term.startDate) < new Date(year.startDate) || new Date(term.endDate) > new Date(year.endDate)) {
          issues.push({
            severity: 'ERROR',
            entity: 'AcademicYear',
            code: 'TERM_OUTSIDE_YEAR_BOUNDS',
            message: `Term '${term.name}' in academic year '${year.name}' falls outside the academic year date bounds.`,
          });
        }
      }

      // Check term overlaps
      const sortedTerms = [...year.terms].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
      for (let i = 1; i < sortedTerms.length; i++) {
        if (new Date(sortedTerms[i - 1].endDate) > new Date(sortedTerms[i].startDate)) {
          issues.push({
            severity: 'ERROR',
            entity: 'AcademicYear',
            code: 'OVERLAPPING_TERMS',
            message: `Overlapping terms detected in academic year '${year.name}': '${sortedTerms[i - 1].name}' and '${sortedTerms[i].name}'.`,
          });
        }
      }
    } else {
      issues.push({
        severity: 'WARNING',
        entity: 'AcademicYear',
        code: 'NO_TERMS_DEFINED',
        message: `Academic year '${year.name}' does not have any terms defined.`,
      });
    }
  }

  return { issues, activeYear, count: years.length };
}

/**
 * Validate Class records for the active academic year.
 * Enforces exactly 15 logical class levels without an unapproved Pre-Nursery class.
 */
async function validateClasses(ClassModel, FacultyModel, activeYearName) {
  const issues = [];
  if (!activeYearName) {
    issues.push({
      severity: 'WARNING',
      entity: 'Class',
      code: 'CLASS_VALIDATION_SKIPPED_NO_YEAR',
      message: 'Class validation skipped because active academic year is missing or ambiguous.',
    });
    return { issues, count: 0, classes: [] };
  }

  const classes = await ClassModel.find({ academicYear: activeYearName });
  const seenCanonicalLevels = new Map(); // canonical -> original names seen
  const seenRawNames = new Set();

  for (const cls of classes) {
    // Check for exact raw duplicate
    if (seenRawNames.has(cls.name)) {
      issues.push({
        severity: 'ERROR',
        entity: 'Class',
        code: 'DUPLICATE_CLASS',
        message: `Duplicate class '${cls.name}' found for academic year '${activeYearName}'.`,
      });
    }
    seenRawNames.add(cls.name);

    // Reject additional Pre-Nursery class
    if (cls.name === 'Pre-Nursery') {
      issues.push({
        severity: 'ERROR',
        entity: 'Class',
        code: 'UNAPPROVED_PRE_NURSERY_CLASS',
        message: "Pre-Nursery is not part of the approved 15-class school structure (approved structure begins at Nursery / NC).",
      });
      continue;
    }

    const canonical = resolveCanonicalClassLevel(cls.name);
    if (!canonical || !CANONICAL_CLASS_LEVELS.includes(canonical)) {
      issues.push({
        severity: 'ERROR',
        entity: 'Class',
        code: 'INVALID_CLASS_NAME',
        message: `Class name '${cls.name}' does not map to any of the 15 approved canonical class levels.`,
      });
      continue;
    }

    // Check for duplicate logical class via alias (e.g. having both 'Nursery' and 'NC')
    if (seenCanonicalLevels.has(canonical)) {
      const priorName = seenCanonicalLevels.get(canonical);
      issues.push({
        severity: 'ERROR',
        entity: 'Class',
        code: 'DUPLICATE_LOGICAL_CLASS',
        message: `Duplicate logical class detected: '${cls.name}' and '${priorName}' both resolve to logical level '${CLASS_LEVEL_LABELS[canonical]}' for academic year '${activeYearName}'.`,
      });
    } else {
      seenCanonicalLevels.set(canonical, cls.name);
    }

    const expectedLevel = getExpectedAcademicLevel(canonical);
    if (expectedLevel && cls.academicLevel !== expectedLevel) {
      issues.push({
        severity: 'WARNING',
        entity: 'Class',
        code: 'ACADEMIC_LEVEL_MISMATCH',
        message: `Class '${cls.name}' has academicLevel '${cls.academicLevel}', expected '${expectedLevel}'.`,
      });
    }

    if (cls.classTeacher && FacultyModel) {
      const teacher = await FacultyModel.findById(cls.classTeacher);
      if (!teacher) {
        issues.push({
          severity: 'ERROR',
          entity: 'Class',
          code: 'DANGLING_CLASS_TEACHER',
          message: `Class '${cls.name}' references non-existent Faculty ID '${cls.classTeacher}' as classTeacher.`,
        });
      }
    }
  }

  // Check for missing offered classes among the 15 approved levels
  const missingLevels = CANONICAL_CLASS_LEVELS.filter((lvl) => !seenCanonicalLevels.has(lvl));
  if (missingLevels.length > 0) {
    const missingLabels = missingLevels.map((lvl) => CLASS_LEVEL_LABELS[lvl] || lvl);
    issues.push({
      severity: 'WARNING',
      entity: 'Class',
      code: 'MISSING_OFFERED_CLASSES',
      message: `The following school class levels are not yet created for ${activeYearName}: ${missingLabels.join(', ')} (${missingLevels.length} missing of 15).`,
      details: missingLevels,
    });
  }

  return { issues, count: classes.length, classes };
}

/**
 * Validate Subject records.
 */
async function validateSubjects(SubjectModel) {
  const issues = [];
  const subjects = await SubjectModel.find();

  const seenCodes = new Set();
  for (const sub of subjects) {
    if (seenCodes.has(sub.code)) {
      issues.push({
        severity: 'ERROR',
        entity: 'Subject',
        code: 'DUPLICATE_SUBJECT_CODE',
        message: `Duplicate subject code '${sub.code}' detected.`,
      });
    }
    seenCodes.add(sub.code);

    if (!sub.name || !sub.name.trim()) {
      issues.push({
        severity: 'ERROR',
        entity: 'Subject',
        code: 'MISSING_SUBJECT_NAME',
        message: `Subject with code '${sub.code}' is missing a name.`,
      });
    }

    if (!VALID_SUBJECT_TYPES.includes(sub.type)) {
      issues.push({
        severity: 'ERROR',
        entity: 'Subject',
        code: 'INVALID_SUBJECT_TYPE',
        message: `Subject '${sub.name}' (${sub.code}) has invalid type '${sub.type}'. Must be one of: ${VALID_SUBJECT_TYPES.join(', ')}.`,
      });
    }

    if (Array.isArray(sub.classLevels)) {
      for (const lvl of sub.classLevels) {
        const canonical = resolveCanonicalClassLevel(lvl);
        if (!canonical || !CANONICAL_CLASS_LEVELS.includes(canonical)) {
          issues.push({
            severity: 'ERROR',
            entity: 'Subject',
            code: 'INVALID_SUBJECT_CLASS_LEVEL',
            message: `Subject '${sub.name}' specifies unapproved classLevel '${lvl}'.`,
          });
        }
      }
    }
  }

  if (subjects.length === 0) {
    issues.push({
      severity: 'WARNING',
      entity: 'Subject',
      code: 'NO_SUBJECTS_DEFINED',
      message: 'No subjects have been defined in the catalog.',
    });
  }

  return { issues, count: subjects.length, subjects };
}

/**
 * Validate Faculty and SubjectAllocations.
 */
async function validateAllocations(SubjectAllocationModel, FacultyModel, SubjectModel, activeYearName) {
  const issues = [];
  if (!activeYearName || !SubjectAllocationModel) {
    return { issues, count: 0 };
  }

  const allocations = await SubjectAllocationModel.find({ academicYear: activeYearName });
  const seenAllocations = new Set();

  for (const alloc of allocations) {
    const canonicalClass = resolveCanonicalClassLevel(alloc.class) || alloc.class;
    const key = `${alloc.teacher}_${alloc.subject}_${canonicalClass}_${alloc.academicYear}`;
    if (seenAllocations.has(key)) {
      issues.push({
        severity: 'ERROR',
        entity: 'SubjectAllocation',
        code: 'DUPLICATE_SUBJECT_ALLOCATION',
        message: `Duplicate subject allocation detected for Teacher '${alloc.teacher}', Subject '${alloc.subject}', Class '${alloc.class}'.`,
      });
    }
    seenAllocations.add(key);

    if (FacultyModel) {
      const faculty = await FacultyModel.findById(alloc.teacher);
      if (!faculty) {
        issues.push({
          severity: 'ERROR',
          entity: 'SubjectAllocation',
          code: 'DANGLING_ALLOCATION_TEACHER',
          message: `Subject allocation references non-existent Faculty ID '${alloc.teacher}'.`,
        });
      }
    }

    if (SubjectModel) {
      const subject = await SubjectModel.findById(alloc.subject);
      if (!subject) {
        issues.push({
          severity: 'ERROR',
          entity: 'SubjectAllocation',
          code: 'DANGLING_ALLOCATION_SUBJECT',
          message: `Subject allocation references non-existent Subject ID '${alloc.subject}'.`,
        });
      } else if (Array.isArray(subject.classLevels) && subject.classLevels.length > 0) {
        const canonicalLevels = subject.classLevels.map((l) => resolveCanonicalClassLevel(l) || l);
        if (!canonicalLevels.includes(canonicalClass)) {
          issues.push({
            severity: 'ERROR',
            entity: 'SubjectAllocation',
            code: 'SUBJECT_NOT_OFFERED_IN_CLASS',
            message: `Subject '${subject.name}' (${subject.code}) is allocated to Class '${alloc.class}', but '${alloc.class}' is not in subject's classLevels.`,
          });
        }
      }
    }

    if (!CANONICAL_CLASS_LEVELS.includes(canonicalClass)) {
      issues.push({
        severity: 'ERROR',
        entity: 'SubjectAllocation',
        code: 'INVALID_ALLOCATION_CLASS',
        message: `Subject allocation specifies unapproved class level '${alloc.class}'.`,
      });
    }
  }

  return { issues, count: allocations.length };
}

/**
 * Validate SchoolSettings.
 */
async function validateSchoolSettings(SchoolSettingsModel) {
  const issues = [];
  if (!SchoolSettingsModel) return { issues, count: 0 };

  const settings = await SchoolSettingsModel.find();
  const seenKeys = new Set();

  for (const setting of settings) {
    if (seenKeys.has(setting.key)) {
      issues.push({
        severity: 'ERROR',
        entity: 'SchoolSettings',
        code: 'DUPLICATE_SETTING_KEY',
        message: `Duplicate setting key '${setting.key}' found.`,
      });
    }
    seenKeys.add(setting.key);
  }

  const recommendedKeys = ['school_name', 'academic_year', 'school_phone', 'school_email'];
  const missingKeys = recommendedKeys.filter((k) => !seenKeys.has(k));
  if (missingKeys.length > 0) {
    issues.push({
      severity: 'WARNING',
      entity: 'SchoolSettings',
      code: 'RECOMMENDED_SETTINGS_MISSING',
      message: `Recommended baseline settings are not yet populated: ${missingKeys.join(', ')}.`,
      details: missingKeys,
    });
  }

  return { issues, count: settings.length };
}

/**
 * Run comprehensive baseline data validation across all baseline entities.
 * Strictly read-only: does not insert, update, delete, or create indexes.
 */
async function validateBaselineData(models) {
  const { AcademicYear, Class, Subject, Faculty, SubjectAllocation, SchoolSettings } = models;

  const allIssues = [];

  // 1. Academic Years
  const yearResult = await validateAcademicYears(AcademicYear);
  allIssues.push(...yearResult.issues);
  const activeYearName = yearResult.activeYear ? yearResult.activeYear.name : null;

  // 2. Classes
  const classResult = await validateClasses(Class, Faculty, activeYearName);
  allIssues.push(...classResult.issues);

  // 3. Subjects
  const subjectResult = await validateSubjects(Subject);
  allIssues.push(...subjectResult.issues);

  // 4. Teacher Allocations
  const allocResult = await validateAllocations(SubjectAllocation, Faculty, Subject, activeYearName);
  allIssues.push(...allocResult.issues);

  // 5. SchoolSettings
  const settingsResult = await validateSchoolSettings(SchoolSettings);
  allIssues.push(...settingsResult.issues);

  const errors = allIssues.filter((i) => i.severity === 'ERROR');
  const warnings = allIssues.filter((i) => i.severity === 'WARNING');

  return {
    valid: errors.length === 0,
    hasWarnings: warnings.length > 0,
    activeAcademicYear: activeYearName,
    summary: {
      academicYearCount: yearResult.count,
      classCount: classResult.count,
      subjectCount: subjectResult.count,
      allocationCount: allocResult.count,
      settingsCount: settingsResult.count,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
    errors,
    warnings,
  };
}

module.exports = {
  CANONICAL_CLASS_LEVELS,
  CLASS_LEVEL_LABELS,
  CLASS_ALIAS_MAP,
  resolveCanonicalClassLevel,
  validateAcademicYears,
  validateClasses,
  validateSubjects,
  validateAllocations,
  validateSchoolSettings,
  validateBaselineData,
};
