'use strict';

const AcademicYear = require('../models/AcademicYear');
const ErrorResponse = require('../utils/errorResponse');
const { parseSchoolDate, schoolDayBounds, isWithinAcademicYear } = require('../utils/attendance-date');

function parseEffectiveDate(value, label = 'enrollment effective date') {
  try {
    const parsed = parseSchoolDate(value, label);
    return { dateKey: parsed.value, effectiveFrom: schoolDayBounds(parsed.value).start };
  } catch (error) {
    throw new ErrorResponse(error.message, 400);
  }
}

async function resolveEffectiveDate(value, academicYearName, { activeOnly = true } = {}) {
  const parsed = parseEffectiveDate(value);
  const filter = activeOnly ? { isActive: true } : {};
  if (academicYearName !== undefined && academicYearName !== null) {
    filter.name = String(academicYearName);
  }

  const years = await AcademicYear.find(filter).select('name startDate endDate').lean();
  let matchingYears;
  try {
    matchingYears = years.filter(year => isWithinAcademicYear(parsed.dateKey, year));
  } catch (error) {
    throw new ErrorResponse('Academic year has invalid date boundaries.', 409);
  }

  if (matchingYears.length !== 1) {
    throw new ErrorResponse(
      matchingYears.length ? 'Enrollment date matches overlapping academic years.' :
        'Enrollment date must fall within a configured academic year.',
      409
    );
  }

  if (academicYearName !== undefined && matchingYears[0].name !== String(academicYearName)) {
    throw new ErrorResponse('Enrollment date does not match the selected academic year.', 400);
  }

  return {
    ...parsed,
    academicYear: matchingYears[0].name,
  };
}

module.exports = { parseEffectiveDate, resolveEffectiveDate };
