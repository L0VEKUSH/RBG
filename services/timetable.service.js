'use strict';

const mongoose = require('mongoose');
const Timetable = require('../models/Timetable');
const Class = require('../models/Class');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const Parent = require('../models/Parent');
const SubjectAllocation = require('../models/SubjectAllocation');
const ErrorResponse = require('../utils/errorResponse');
const { isValidAcademicYear } = require('../utils/academic-year');

const CLASS_LEVELS = new Set([
  'Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
]);
const DAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
const PERIOD_TYPES = new Set(['Regular', 'Lab', 'Library', 'Sports', 'Break', 'Assembly']);
const MANAGER_ROLES = new Set(['super_admin', 'school_admin', 'admin', 'principal', 'academic_coordinator']);
const TEACHER_ROLES = new Set(['teacher', 'class_teacher', 'faculty']);

function sanitizeTimetable(data, creating = false) {
  const fields = new Set(['class', 'academicYear', 'day', 'periods', 'isActive']);
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).some(field => !fields.has(field))) {
    throw new ErrorResponse('Invalid timetable data', 400);
  }
  const clean = {};
  for (const field of fields) if (data[field] !== undefined) clean[field] = data[field];
  if (clean.class !== undefined && !CLASS_LEVELS.has(clean.class)) {
    throw new ErrorResponse('Choose a valid timetable class', 400);
  }
  if (clean.academicYear !== undefined) {
    const match = typeof clean.academicYear === 'string' && /^(\d{4})-(\d{4})$/.exec(clean.academicYear);
    if (!match || Number(match[2]) !== Number(match[1]) + 1) {
      throw new ErrorResponse('Academic year must use consecutive YYYY-YYYY dates', 400);
    }
  }
  if (clean.day !== undefined && !DAYS.has(clean.day)) {
    throw new ErrorResponse('Choose a valid timetable weekday', 400);
  }
  if (clean.isActive !== undefined && typeof clean.isActive !== 'boolean') {
    throw new ErrorResponse('Timetable active status must be a boolean', 400);
  }
  if (clean.periods !== undefined) {
    if (!Array.isArray(clean.periods) || clean.periods.length === 0) {
      throw new ErrorResponse('A timetable needs at least one period', 400);
    }
    clean.periods = clean.periods.map(period => {
      const allowed = new Set(['periodNumber', 'startTime', 'endTime', 'subject', 'teacher', 'room', 'type']);
      if (!period || typeof period !== 'object' || Array.isArray(period) ||
          Object.keys(period).some(field => !allowed.has(field))) {
        throw new ErrorResponse('Invalid timetable period', 400);
      }
      const periodNumber = Number(period.periodNumber);
      if (!Number.isInteger(periodNumber) || periodNumber < 1) {
        throw new ErrorResponse('Period number must be a positive whole number', 400);
      }
      if (typeof period.subject !== 'string' || !period.subject.trim()) {
        throw new ErrorResponse('Each period needs a subject or activity name', 400);
      }
      if (period.type !== undefined && !PERIOD_TYPES.has(period.type)) {
        throw new ErrorResponse('Choose a valid timetable period type', 400);
      }
      if (period.teacher && !mongoose.isValidObjectId(period.teacher)) {
        throw new ErrorResponse('Choose a valid teacher for the timetable period', 400);
      }
      return {
        periodNumber,
        subject: period.subject.trim(),
        ...(period.startTime ? { startTime: String(period.startTime) } : {}),
        ...(period.endTime ? { endTime: String(period.endTime) } : {}),
        ...(period.teacher ? { teacher: period.teacher } : {}),
        ...(period.room ? { room: String(period.room).trim() } : {}),
        ...(period.type ? { type: period.type } : {}),
      };
    });
    const periodNumbers = clean.periods.map(period => period.periodNumber);
    if (new Set(periodNumbers).size !== periodNumbers.length) {
      throw new ErrorResponse('Period numbers must be unique within a day', 400);
    }
  }
  if (creating && (!clean.class || !clean.academicYear || !clean.day || !clean.periods)) {
    throw new ErrorResponse('Class, academic year, weekday, and periods are required', 400);
  }
  return clean;
}

async function requireExistingClassYear(className, academicYear) {
  const classRecord = await Class.findOne({ name: className, academicYear });
  if (!classRecord) throw new ErrorResponse('Choose a class and academic year that exist in school records', 400);
}

/**
 * Detect cross-class teacher and room conflicts for a proposed set of periods.
 *
 * Uses periodNumber as the slot identity (startTime/endTime are optional strings
 * and are not used for overlap math).
 *
 * Concurrency note: this is a best-effort read-then-write check. Two simultaneous
 * requests that both pass this check can still produce a conflict if they write
 * concurrently. The unique compound index on {class, academicYear, day} prevents
 * duplicate documents but cannot prevent period-level teacher/room collisions at
 * the database layer. Callers should be aware of this limitation.
 *
 * @param {string}   day             - e.g. 'Monday'
 * @param {string}   academicYear    - e.g. '2024-2025'
 * @param {object[]} incomingPeriods - sanitized period objects from the write path
 * @param {string|null} excludeId   - timetable document _id to exclude (for updates)
 */
async function assertNoConflicts(day, academicYear, incomingPeriods, excludeId) {
  if (!Array.isArray(incomingPeriods) || incomingPeriods.length === 0) return;

  // Build lookup maps for fast O(1) checks per period number
  const teacherByPeriod = new Map();
  const roomByPeriod    = new Map();
  for (const p of incomingPeriods) {
    const pn = p.periodNumber;
    if (p.teacher) teacherByPeriod.set(pn, String(p.teacher));
    if (p.room && String(p.room).trim()) roomByPeriod.set(pn, String(p.room).trim().toLowerCase());
  }

  // Nothing to check if the incoming periods have no teachers or rooms
  if (teacherByPeriod.size === 0 && roomByPeriod.size === 0) return;

  const query = { day, academicYear };
  if (excludeId) query._id = { $ne: excludeId };

  const others = await Timetable.find(query).select('class periods').lean();

  for (const doc of others) {
    for (const p of (doc.periods || [])) {
      const pn = p.periodNumber;

      // Teacher conflict
      if (p.teacher && teacherByPeriod.has(pn)) {
        if (String(p.teacher) === teacherByPeriod.get(pn)) {
          throw new ErrorResponse(
            `A teacher is already assigned to period ${pn} in class ${doc.class} on ${day}`,
            409
          );
        }
      }

      // Room conflict (case-insensitive, ignore empty)
      if (p.room && String(p.room).trim() && roomByPeriod.has(pn)) {
        if (String(p.room).trim().toLowerCase() === roomByPeriod.get(pn)) {
          throw new ErrorResponse(
            `Room "${String(p.room).trim()}" is already in use for period ${pn} in class ${doc.class} on ${day}`,
            409
          );
        }
      }
    }
  }
}

function actorId(user) {
  return user?._id || user?.id;
}

function normalizeRole(user) {
  return String(user?.role || '').toLowerCase();
}

function retainTeacherPeriods(schedules, facultyId) {
  return schedules.map(schedule => {
    const output = typeof schedule.toObject === 'function' ? schedule.toObject() : { ...schedule };
    output.periods = (output.periods || []).filter(period => {
      const assignedTeacherId = period.teacher?._id || period.teacher;
      return String(assignedTeacherId || '') === String(facultyId);
    });
    return output;
  });
}

async function getTeacherAcademicYears(faculty, className) {
  const filter = { teacher: faculty._id };
  if (className) filter.class = className;
  const assignments = await SubjectAllocation.find(filter).select('class academicYear');
  const years = assignments
    .filter(assignment => CLASS_LEVELS.has(assignment.class) && isValidAcademicYear(assignment.academicYear))
    .map(assignment => assignment.academicYear);
  const classTeacher = faculty.classTeacherOf;
  if (CLASS_LEVELS.has(classTeacher?.class) && (!className || classTeacher.class === className)
      && isValidAcademicYear(classTeacher.academicYear)) {
    years.push(classTeacher.academicYear);
  }
  return [...new Set(years)];
}

exports.getTimetable = async () => {
  return Timetable.find().populate('periods.teacher', 'user designation');
};

exports.createTimetable = async data => {
  const timetable = sanitizeTimetable(data, true);
  await requireExistingClassYear(timetable.class, timetable.academicYear);
  await assertNoConflicts(timetable.day, timetable.academicYear, timetable.periods, null);
  return Timetable.create(timetable);
};

exports.updateTimetable = async (id, data) => {
  const timetable = sanitizeTimetable(data);
  const current = await Timetable.findById(id);
  if (!current) return null;
  const effectiveDay     = timetable.day          || current.day;
  const effectiveYear    = timetable.academicYear  || current.academicYear;
  const effectivePeriods = timetable.periods       || current.periods;
  await requireExistingClassYear(timetable.class || current.class, effectiveYear);
  await assertNoConflicts(effectiveDay, effectiveYear, effectivePeriods, id);
  return Timetable.findByIdAndUpdate(id, timetable, {
    new: true,
    runValidators: true,
    strict: true,
  });
};

exports.getTimetableByClass = async (classLevel, requestedYear, user) => {
  if (!CLASS_LEVELS.has(classLevel) || !user) throw new ErrorResponse('Timetable not found', 404);
  const role = normalizeRole(user);
  let years;
  let teacherFaculty = null;
  let assignedClassTeacherYear = null;

  if (MANAGER_ROLES.has(role)) {
    const filter = { class: classLevel, isActive: { $ne: false } };
    if (requestedYear) filter.academicYear = requestedYear;
    return Timetable.find(filter).populate('periods.teacher', 'user designation');
  }

  if (role === 'student') {
    const student = await Student.findOne({ user: actorId(user), isActive: { $ne: false } })
      .select('class academicYear');
    if (!student || !isValidAcademicYear(student.academicYear)
        || student.class !== classLevel || (requestedYear && student.academicYear !== requestedYear)) {
      throw new ErrorResponse('Timetable not found', 404);
    }
    years = [student.academicYear];
  } else if (TEACHER_ROLES.has(role)) {
    teacherFaculty = await Faculty.findOne({ user: actorId(user), isActive: { $ne: false } })
      .select('_id classTeacherOf');
    if (!teacherFaculty) throw new ErrorResponse('Timetable not found', 404);
    years = await getTeacherAcademicYears(teacherFaculty, classLevel);
    if (teacherFaculty.classTeacherOf?.class === classLevel
        && isValidAcademicYear(teacherFaculty.classTeacherOf.academicYear)) {
      assignedClassTeacherYear = teacherFaculty.classTeacherOf.academicYear;
    }
    if (requestedYear && !years.includes(requestedYear)) throw new ErrorResponse('Timetable not found', 404);
    if (!years.length) throw new ErrorResponse('Timetable not found', 404);
  } else if (role === 'parent') {
    if (!isValidAcademicYear(requestedYear)) throw new ErrorResponse('Timetable not found', 404);
    const parent = await Parent.findOne({ user: actorId(user) }).select('children');
    const childIds = Array.isArray(parent?.children) ? parent.children.map(id => id?._id || id) : [];
    const linkedStudents = await Student.find({
      class: classLevel,
      academicYear: requestedYear,
      isActive: { $ne: false },
      $or: [{ _id: { $in: childIds } }, { parentUser: actorId(user) }],
    }).select('academicYear');
    years = linkedStudents.length ? [requestedYear] : [];
    if (!years.length) throw new ErrorResponse('Timetable not found', 404);
  } else {
    throw new ErrorResponse('Not authorized to view this timetable', 403);
  }

  const filter = { class: classLevel, academicYear: { $in: years }, isActive: { $ne: false } };
  const schedules = await Timetable.find(filter).populate('periods.teacher', 'user designation');
  if (TEACHER_ROLES.has(role)) {
    return schedules.flatMap(schedule => {
      if (schedule.academicYear === assignedClassTeacherYear) return [schedule];
      const ownPeriods = retainTeacherPeriods([schedule], teacherFaculty._id);
      return ownPeriods[0]?.periods?.length ? ownPeriods : [];
    });
  }
  return schedules;
};

exports.getTimetableByTeacher = async (teacherUserId, user) => {
  if (!user) throw new ErrorResponse('Not authenticated', 401);
  const role = normalizeRole(user);
  if (!MANAGER_ROLES.has(role) && (!TEACHER_ROLES.has(role) || String(actorId(user)) !== String(teacherUserId))) {
    throw new ErrorResponse('Not authorized to view this teacher timetable', 403);
  }
  const faculty = await Faculty.findOne({ user: teacherUserId, isActive: { $ne: false } });
  if (!faculty) return [];
  const filter = { isActive: { $ne: false }, 'periods.teacher': faculty._id };
  if (!MANAGER_ROLES.has(role)) {
    const years = await getTeacherAcademicYears(faculty);
    if (!years.length) return [];
    filter.academicYear = { $in: years };
  }
  const schedules = await Timetable.find(filter)
    .populate('periods.teacher', 'user designation');
  return retainTeacherPeriods(schedules, faculty._id);
};

exports.getMyTimetable = async (userId, role) => {
  if (role === 'student') {
    const student = await Student.findOne({ user: userId, isActive: { $ne: false } })
      .select('class academicYear');
    if (!student || !student.class || !isValidAcademicYear(student.academicYear)) return [];
    return Timetable.find({
      class: student.class,
      academicYear: student.academicYear,
      isActive: { $ne: false },
    }).populate('periods.teacher', 'user');
  }
  if (TEACHER_ROLES.has(String(role || '').toLowerCase())) {
    const faculty = await Faculty.findOne({ user: userId, isActive: { $ne: false } });
    if (!faculty) return [];
    const years = await getTeacherAcademicYears(faculty);
    if (!years.length) return [];
    const schedules = await Timetable.find({
      isActive: { $ne: false },
      'periods.teacher': faculty._id,
      academicYear: { $in: years },
    })
      .populate('periods.teacher', 'user designation');
    return retainTeacherPeriods(schedules, faculty._id);
  }
  return [];
};
