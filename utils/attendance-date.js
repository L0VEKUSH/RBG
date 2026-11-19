const SCHOOL_TIME_ZONE = 'Asia/Kolkata';
const SCHOOL_OFFSET_MINUTES = 330;
const DAY_MS = 24 * 60 * 60 * 1000;

function utcCalendarDate(year, month, day) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function parseSchoolDate(value, label = 'attendance date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`A ${label} in YYYY-MM-DD format is required`);
  }

  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || year > 9999) throw new TypeError(`Invalid ${label}`);
  const calendarDate = utcCalendarDate(year, month, day);
  if (calendarDate.getUTCFullYear() !== year ||
      calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day) {
    throw new TypeError(`Invalid ${label}`);
  }
  return { value, year, month, day };
}

function schoolDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid stored attendance date');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${String(fields.year).padStart(4, '0')}-${fields.month}-${fields.day}`;
}

function schoolDayBounds(value) {
  const parsed = parseSchoolDate(value);
  const utcMidnight = utcCalendarDate(parsed.year, parsed.month, parsed.day).getTime();
  const start = new Date(utcMidnight - SCHOOL_OFFSET_MINUTES * 60 * 1000);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function nextSchoolDate(value) {
  const parsed = parseSchoolDate(value);
  const next = utcCalendarDate(parsed.year, parsed.month, parsed.day);
  next.setUTCDate(next.getUTCDate() + 1);
  if (next.getUTCFullYear() > 9999) throw new TypeError('School date is out of range');
  return `${String(next.getUTCFullYear()).padStart(4, '0')}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function schoolMonthBounds(year, month) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  if (!Number.isInteger(numericYear) || numericYear < 1 || numericYear > 9999 ||
      !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
    throw new TypeError('Valid attendance month and year are required');
  }
  const monthKey = `${String(numericYear).padStart(4, '0')}-${String(numericMonth).padStart(2, '0')}-01`;
  const start = schoolDayBounds(monthKey).start;
  const nextMonth = numericMonth === 12 ? 1 : numericMonth + 1;
  const nextYear = numericMonth === 12 ? numericYear + 1 : numericYear;
  if (nextYear > 9999) throw new TypeError('Attendance month is out of range');
  const nextKey = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start, end: schoolDayBounds(nextKey).start };
}

function todaySchoolDate(now = new Date()) {
  return schoolDateKey(now);
}

function academicYearDateKeys(academicYear) {
  if (!academicYear || !(academicYear.startDate instanceof Date) ||
      !(academicYear.endDate instanceof Date) ||
      Number.isNaN(academicYear.startDate.getTime()) ||
      Number.isNaN(academicYear.endDate.getTime())) {
    throw new TypeError('Academic year has invalid date boundaries');
  }
  const start = schoolDateKey(academicYear.startDate);
  const end = schoolDateKey(academicYear.endDate);
  if (start > end) throw new TypeError('Academic year date boundaries are invalid');
  return { start, end };
}

function isWithinAcademicYear(dateKey, academicYear) {
  const date = parseSchoolDate(dateKey).value;
  const bounds = academicYearDateKeys(academicYear);
  return date >= bounds.start && date <= bounds.end;
}

module.exports = {
  SCHOOL_TIME_ZONE,
  parseSchoolDate,
  schoolDateKey,
  schoolDayBounds,
  nextSchoolDate,
  schoolMonthBounds,
  todaySchoolDate,
  academicYearDateKeys,
  isWithinAcademicYear,
};
