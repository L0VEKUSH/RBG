'use strict';

function parseAcademicYear(year) {
  if (typeof year !== 'string') return null;
  const match = /^(\d{4})-(\d{4})$/.exec(year);
  if (!match) return null;

  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (endYear !== startYear + 1) return null;

  return { startYear, endYear };
}

function isValidAcademicYear(year) {
  return parseAcademicYear(year) !== null;
}

module.exports = { isValidAcademicYear, parseAcademicYear };
