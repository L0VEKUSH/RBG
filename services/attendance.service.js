const mongoose = require('mongoose');
const crypto = require('node:crypto');
const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const Parent = require('../models/Parent');
const SubjectAllocation = require('../models/SubjectAllocation');
const Subject = require('../models/Subject');
const AcademicYear = require('../models/AcademicYear');
const { getRolePermissions } = require('../config/permissions');
const ErrorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');
const {
  parseSchoolDate,
  schoolDateKey,
  schoolDayBounds,
  schoolMonthBounds,
  todaySchoolDate,
  academicYearDateKeys,
  isWithinAcademicYear,
} = require('../utils/attendance-date');

const TEACHER_ROLES = new Set(['teacher', 'class_teacher', 'faculty']);
const LEADERSHIP_ROLES = new Set([
  'super_admin', 'school_admin', 'admin', 'principal', 'vice_principal',
]);
const MARK_STATUSES = new Set(['Present', 'Absent', 'Late', 'Half-Day', 'Holiday']);
const UPDATE_STATUSES = new Set(['Present', 'Absent', 'Late', 'Half-Day', 'Holiday']);

function actorId(actor) {
  return actor && (actor._id || actor.id);
}

function effectivePermissions(actor) {
  const effective = new Set(getRolePermissions(actor?.role));
  for (const override of Array.isArray(actor?.permissions) ? actor.permissions : []) {
    if (typeof override !== 'string') continue;
    if (override.startsWith('-')) effective.delete(override.slice(1));
    else effective.add(override);
  }
  return effective;
}

function requireActor(actor, permissions) {
  if (!actorId(actor)) throw new ErrorResponse('Not authenticated', 401);
  const effective = effectivePermissions(actor);
  if (effective.has('*') || permissions.some(permission => effective.has(permission))) return;
  throw new ErrorResponse('Access denied', 403);
}

function requireLeadership(actor, permission) {
  if (!LEADERSHIP_ROLES.has(actor?.role)) throw new ErrorResponse('Access denied', 403);
  requireActor(actor, [permission]);
}

function requireWriteActor(actor, permission) {
  if (LEADERSHIP_ROLES.has(actor?.role)) requireLeadership(actor, permission);
  else requireActor(actor, [permission]);
}

function isValidClass(className) {
  return typeof className === 'string' && Student.CLASS_LEVELS.includes(className);
}

function validAcademicYear(year) {
  return typeof year === 'string' && /^\d{4}-\d{4}$/.test(year);
}

function enrollmentMatches(student, className, academicYear) {
  if (String(student.class) === className && String(student.academicYear) === academicYear) return true;
  return (student.enrollmentHistory || []).some(entry =>
    String(entry.class) === className && String(entry.academicYear) === academicYear
  );
}

function expectedRevision(value, field = 'expectedRevision') {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ErrorResponse(`${field} must be a nonnegative integer or null`, 400);
  }
  return value;
}

function revisionFilter(key, revision) {
  if (revision === null) return key;
  if (revision === 0) return { ...key, $or: [{ revision: 0 }, { revision: { $exists: false } }] };
  return { ...key, revision };
}

function useSession(query, session) {
  return session ? query.session(session) : query;
}

function requireSharedAttendanceConnection() {
  const models = [Attendance, Student, Faculty, SubjectAllocation, Subject, AcademicYear];
  const connection = Attendance.db;
  if (!connection || typeof connection.startSession !== 'function' ||
      models.some(model => !model || model.db !== connection)) {
    throw new ErrorResponse('Attendance transaction models are not on one MongoDB connection', 503);
  }
  return connection;
}

function exactKeyPattern(actual, expected) {
  if (!actual || typeof actual !== 'object') return false;
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key]);
}

function globallyEnforcingUniqueIndex(index) {
  return index?.unique === true &&
    index.sparse !== true &&
    !index.partialFilterExpression &&
    !index.expireAfterSeconds &&
    (!index.collation || index.collation.locale === 'simple');
}

async function requireLogicalUniqueIndex() {
  let indexes;
  try {
    indexes = await Attendance.collection.indexes();
  } catch (_) {
    throw new ErrorResponse('Attendance index metadata is unavailable; attendance writes are disabled', 503);
  }
  const expected = { student: 1, class: 1, date: 1, subject: 1, academicYear: 1 };
  const narrowLegacy = { student: 1, date: 1, subject: 1 };
  if (indexes.some(index => exactKeyPattern(index.key, narrowLegacy) && index.unique === true)) {
    throw new ErrorResponse('An incompatible attendance uniqueness index is present; attendance writes are disabled', 503);
  }
  if (!indexes.some(index => exactKeyPattern(index.key, expected) && globallyEnforcingUniqueIndex(index))) {
    throw new ErrorResponse('The required attendance uniqueness index is not verified; attendance writes are disabled', 503);
  }
}

function isUnknownCommitOutcome(error) {
  return Boolean(error && (
    (typeof error.hasErrorLabel === 'function' && error.hasErrorLabel('UnknownTransactionCommitResult')) ||
    (Array.isArray(error.errorLabels) && error.errorLabels.includes('UnknownTransactionCommitResult'))
  ));
}

function isTransactionUnavailable(error) {
  return Boolean(error && (
    error.code === 20 ||
    /transaction numbers are only allowed|transactions are not supported|does not support transactions/i.test(String(error.message || ''))
  ));
}

function isDuplicateOrWriteConflict(error) {
  return Boolean(error && (
    error.code === 11000 || error.code === 112 ||
    (typeof error.hasErrorLabel === 'function' && error.hasErrorLabel('TransientTransactionError')) ||
    (Array.isArray(error.errorLabels) && error.errorLabels.includes('TransientTransactionError'))
  ));
}

async function runAttendanceTransaction(callback) {
  const connection = requireSharedAttendanceConnection();
  let session;
  try {
    session = await connection.startSession();
    return await session.withTransaction(callback, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    });
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch (_) {
        // Do not turn a confirmed transaction commit into an apparent write failure.
      }
    }
  }
}

function normalizeRequestedDate(value, label = 'attendance date') {
  try {
    return parseSchoolDate(value, label).value;
  } catch (error) {
    throw new ErrorResponse(error.message, 400);
  }
}

function enrollmentSegmentsForYear(student, academicYear, academicYearRecord) {
  let yearBounds;
  try {
    yearBounds = academicYearDateKeys(academicYearRecord);
  } catch (_) {
    return null;
  }
  const history = Array.isArray(student.enrollmentHistory) ? student.enrollmentHistory : [];
  const segments = [];

  for (const entry of history) {
    if (String(entry.academicYear || '') !== academicYear) continue;
    if (!entry.class || !entry.effectiveFrom || !entry.promotedDate) return null;
    let start;
    let end;
    try {
      start = schoolDateKey(entry.effectiveFrom);
      end = schoolDateKey(entry.promotedDate);
    } catch (_) {
      return null;
    }
    if (start >= end) return null;
    segments.push({ className: String(entry.class), start, end });
  }

  if (String(student.academicYear || '') === academicYear && student.class) {
    let start;
    try {
      if (!student.enrollmentEffectiveFrom) return null;
      start = schoolDateKey(student.enrollmentEffectiveFrom);
    } catch (_) {
      return null;
    }
    segments.push({ className: String(student.class), start, end: incrementDateKey(yearBounds.end) });
  }

  const clipped = segments.map(segment => ({
    ...segment,
    start: segment.start < yearBounds.start ? yearBounds.start : segment.start,
    end: segment.end > incrementDateKey(yearBounds.end) ? incrementDateKey(yearBounds.end) : segment.end,
  })).filter(segment => segment.start < segment.end);
  const ordered = [...clipped].sort((left, right) => left.start.localeCompare(right.start));
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1].end > ordered[index].start) return null;
  }
  return { yearBounds, segments: ordered };
}

function enrollmentEffectiveForDate(student, className, academicYear, dateKey, academicYearRecord) {
  const enrollment = enrollmentSegmentsForYear(student, academicYear, academicYearRecord);
  if (!enrollment) return false;
  const matches = enrollment.segments.filter(segment =>
    segment.className === className && segment.start <= dateKey && dateKey < segment.end
  );
  return matches.length === 1;
}

function summarizeAttendanceRecords(records) {
  const summary = { Present: 0, Absent: 0, Late: 0, 'Half-Day': 0, Leave: 0, Holiday: 0 };
  for (const record of records) {
    if (Object.prototype.hasOwnProperty.call(summary, record.status)) summary[record.status] += 1;
  }
  const total = summary.Present + summary.Absent + summary.Late + summary['Half-Day'] + summary.Leave;
  summary.total = total;
  summary.percentage = total > 0
    ? Number(((summary.Present + summary.Late) / total * 100).toFixed(2))
    : 0;
  return summary;
}

function incrementDateKey(dateKey) {
  const { year, month, day } = parseSchoolDate(dateKey);
  if (year === 9999 && month === 12 && day === 31) return '9999-12-32';
  const next = new Date(0);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCFullYear(year, month - 1, day + 1);
  return `${String(next.getUTCFullYear()).padStart(4, '0')}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function idString(value) {
  return String(value && value._id ? value._id : value);
}

function studentAttendanceDTO(student) {
  if (!student) return null;
  const user = student.user && typeof student.user === 'object' ? student.user : null;
  return {
    _id: idString(student._id),
    name: user?.name || null,
    admissionNumber: student.admissionNumber || null,
    rollNumber: student.rollNumber ?? null,
    class: student.class || null,
    academicYear: student.academicYear || null,
  };
}

function attendanceRecordDTO(record) {
  const populatedStudent = record.student && typeof record.student === 'object' && (
    record.student.user || record.student.rollNumber !== undefined ||
    record.student.admissionNumber !== undefined
  );
  const student = populatedStudent ? studentAttendanceDTO(record.student) : null;
  if (student) {
    // The student's current enrollment may differ from this historical record.
    student.class = record.class || null;
    student.academicYear = record.academicYear || null;
  }
  return {
    _id: idString(record._id),
    studentId: student?._id || idString(record.student),
    student,
    class: record.class,
    date: schoolDateKey(record.date),
    status: record.status,
    subject: record.subject,
    academicYear: record.academicYear,
    revision: Number.isSafeInteger(record.revision) ? record.revision : 0,
  };
}

async function assertStudentsBelongToClass(attendanceData, className, academicYear, dateKey, academicYearRecord, session) {
  if (!Array.isArray(attendanceData) || attendanceData.length === 0) {
    throw new ErrorResponse('Attendance data must be a non-empty array', 400);
  }
  const studentIds = attendanceData.map(record => record && record.student);
  const validStudentIds = studentIds.filter(id => mongoose.Types.ObjectId.isValid(id));
  if (validStudentIds.length !== studentIds.length ||
      new Set(studentIds.map(idString)).size !== studentIds.length) {
    throw new ErrorResponse('Invalid attendance data', 400);
  }
  if (attendanceData.some(record => !record || !MARK_STATUSES.has(record.status))) {
    throw new ErrorResponse('Invalid attendance status', 400);
  }

  const studentQuery = Student.find({ _id: { $in: validStudentIds }, isActive: true })
    .select('_id class academicYear enrollmentEffectiveFrom enrollmentHistory');
  const students = await useSession(studentQuery, session);
  const validIds = new Set(students.map(student => idString(student._id)));
  if (validIds.size !== studentIds.length ||
      studentIds.some(id => !validIds.has(idString(id)))) {
    throw new ErrorResponse('Attendance student is not active or could not be verified', 403);
  }
  for (const student of students) {
    if (!enrollmentEffectiveForDate(student, className, academicYear, dateKey, academicYearRecord)) {
      throw new ErrorResponse('Attendance enrollment is missing, ambiguous, or not effective on the selected date', 403);
    }
  }
}

async function getClassYearRoster(className, academicYear, academicYearRecord, rangeStart, rangeEnd) {
  const bounds = academicYearDateKeys(academicYearRecord);
  const firstDate = rangeStart || bounds.start;
  const lastDateExclusive = incrementDateKey(rangeEnd || bounds.end);
  const students = await Student.find({
    $or: [
      { class: className, academicYear },
      { enrollmentHistory: { $elemMatch: { class: className, academicYear } } },
    ],
  })
    .select('_id user admissionNumber rollNumber class academicYear enrollmentEffectiveFrom enrollmentHistory')
    .populate('user', 'name')
    .sort('rollNumber');

  return students.map(student => {
    const enrollment = enrollmentSegmentsForYear(student, academicYear, academicYearRecord);
    if (!enrollment) {
      throw new ErrorResponse(
        'Attendance roster cannot be verified because enrollment history is missing or ambiguous',
        503
      );
    }
    const periods = enrollment.segments.filter(segment =>
      segment.className === className && segment.start < lastDateExclusive && segment.end > firstDate
    );
    if (!periods?.length) return null;
    const historicalEnrollment = (student.enrollmentHistory || []).find(entry => {
      if (String(entry.class) !== className || String(entry.academicYear) !== academicYear ||
          !entry.effectiveFrom || !entry.promotedDate) return false;
      const start = schoolDateKey(entry.effectiveFrom);
      const end = schoolDateKey(entry.promotedDate);
      return start < lastDateExclusive && end > firstDate;
    });
    const currentEnrollment = String(student.class) === className &&
      String(student.academicYear) === academicYear && student.enrollmentEffectiveFrom &&
      schoolDateKey(student.enrollmentEffectiveFrom) < lastDateExclusive &&
      incrementDateKey(bounds.end) > firstDate;
    const record = student.toObject ? student.toObject() : student;
    return {
      student: {
        _id: idString(student._id),
        name: record.user?.name || null,
        admissionNumber: student.admissionNumber || null,
        rollNumber: currentEnrollment ? student.rollNumber : historicalEnrollment?.rollNumber ?? null,
        class: className,
        academicYear,
      },
      periods,
    };
  }).filter(Boolean);
}

class AttendanceService {
  async loadTeacherScope(user, className, academicYear, permission = 'attendance.view-assigned', session) {
    requireActor(user, [permission]);
    if (!isValidClass(className) || !validAcademicYear(academicYear)) {
      throw new ErrorResponse('Class and academic year are required', 400);
    }

    const facultyQuery = Faculty.findOne({ user: actorId(user), isActive: true })
      .select('_id classTeacherOf');
    const faculty = await useSession(facultyQuery, session);
    if (!faculty) throw new ErrorResponse('Access denied', 403);

    const classTeacher = faculty.classTeacherOf || {};
    if (String(classTeacher.class || '') === className &&
        String(classTeacher.academicYear || '') === academicYear) {
      return { faculty, isClassTeacher: true, subjects: null };
    }

    const allocationQuery = SubjectAllocation.find({
      teacher: faculty._id,
      class: className,
      academicYear,
    }).select('subject');
    const allocations = await useSession(allocationQuery, session);
    if (!allocations.length) throw new ErrorResponse('Access denied', 403);

    const subjectIds = allocations.map(allocation => allocation.subject).filter(Boolean);
    const subjectQuery = Subject.find({ _id: { $in: subjectIds } }).select('_id name code');
    const subjects = await useSession(subjectQuery, session);
    const subjectValues = new Set(subjectIds.map(idString));
    for (const subject of subjects) {
      subjectValues.add(idString(subject._id));
      if (subject.name) subjectValues.add(String(subject.name));
      if (subject.code) subjectValues.add(String(subject.code));
    }

    return {
      faculty,
      isClassTeacher: false,
      subjects: [...subjectValues],
    };
  }

  async assertClassReadAccess(user, className, academicYear, leadershipPermission) {
    if (!actorId(user)) throw new ErrorResponse('Not authenticated', 401);
    if (!isValidClass(className)) throw new ErrorResponse('Invalid class', 400);
    if (!validAcademicYear(academicYear)) {
      throw new ErrorResponse('A valid academic year is required', 400);
    }

    if (TEACHER_ROLES.has(user.role)) {
      const teacherPermission = leadershipPermission === 'attendance.report'
        ? 'attendance.report'
        : 'attendance.view-assigned';
      return this.loadTeacherScope(user, className, academicYear, teacherPermission);
    }

    requireLeadership(user, leadershipPermission);
    return { isLeadership: true, subjects: null };
  }

  async assertTeacherAssignment(user, className, subject, academicYear, permission = 'attendance.mark', session) {
    if (!actorId(user)) throw new ErrorResponse('Not authenticated', 401);
    if (LEADERSHIP_ROLES.has(user.role)) {
      requireLeadership(user, permission);
      return { isLeadership: true };
    }

    const scope = await this.loadTeacherScope(user, className, academicYear, permission, session);
    if (!subject || subject === 'General') {
      if (!scope.isClassTeacher) throw new ErrorResponse('Access denied', 403);
      return scope;
    }

    const subjectFilter = mongoose.Types.ObjectId.isValid(subject)
      ? { _id: subject }
      : { $or: [{ name: subject }, { code: subject }] };
    const subjectQuery = Subject.findOne({
      ...subjectFilter,
      isActive: true,
      classLevels: className,
    }).select('_id');
    const subjectRecord = await useSession(subjectQuery, session);
    if (!subjectRecord) throw new ErrorResponse('Access denied', 403);

    const allocationQuery = SubjectAllocation.findOne({
      teacher: scope.faculty._id,
      subject: subjectRecord._id,
      class: className,
      academicYear,
    });
    const allocation = await useSession(allocationQuery, session);
    if (!allocation) throw new ErrorResponse('Access denied', 403);
    return { ...scope, subjectRecord };
  }

  async markBulkAttendance(data, user) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ErrorResponse('Invalid attendance request', 400);
    }
    const { class: className, date, attendanceData, academicYear, subject } = data;
    if (!isValidClass(className) || !validAcademicYear(academicYear)) {
      throw new ErrorResponse('Valid class and academic year are required', 400);
    }
    const dateKey = normalizeRequestedDate(date);
    const dateBounds = schoolDayBounds(dateKey);
    const normalizedSubject = subject || 'General';
    if (typeof normalizedSubject !== 'string' || !normalizedSubject.trim()) {
      throw new ErrorResponse('A valid attendance subject is required', 400);
    }
    if (!Array.isArray(attendanceData) || attendanceData.length === 0) {
      throw new ErrorResponse('Attendance data must be a non-empty array', 400);
    }
    const rows = attendanceData.map(record => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new ErrorResponse('Invalid attendance record', 400);
      }
      if (!Object.prototype.hasOwnProperty.call(record, 'expectedRevision')) {
        throw new ErrorResponse('expectedRevision is required for every attendance record', 400);
      }
      return {
        student: record.student,
        status: record.status,
        remarks: typeof record.remarks === 'string' ? record.remarks : '',
        expectedRevision: expectedRevision(record.expectedRevision),
      };
    });
    const studentIds = rows.map(row => row.student);
    if (studentIds.some(id => !mongoose.Types.ObjectId.isValid(id)) ||
        new Set(studentIds.map(idString)).size !== studentIds.length ||
        rows.some(row => !MARK_STATUSES.has(row.status))) {
      throw new ErrorResponse('Invalid or duplicate attendance records', 400);
    }

    requireWriteActor(user, 'attendance.mark');
    requireSharedAttendanceConnection();
    await requireLogicalUniqueIndex();
    const operationId = crypto.randomUUID();
    const expectedUpdates = rows.filter(row => row.expectedRevision !== null).length;
    const expectedInserts = rows.length - expectedUpdates;
    const committedResult = {
      operationId,
      matchedCount: expectedUpdates,
      modifiedCount: expectedUpdates,
      upsertedCount: expectedInserts,
      records: rows.map(row => ({
        studentId: idString(row.student),
        status: row.status,
        date: dateKey,
        class: className,
        subject: normalizedSubject,
        academicYear,
        revision: row.expectedRevision === null ? 1 : row.expectedRevision + 1,
      })),
    };
    try {
      await runAttendanceTransaction(async session => {
        await this.assertTeacherAssignment(
          user, className, normalizedSubject, academicYear, 'attendance.mark', session
        );
        const yearQuery = AcademicYear.findOne({ name: academicYear })
          .select('name startDate endDate');
        const yearRecord = await useSession(yearQuery, session);
        if (!yearRecord) throw new ErrorResponse('Academic year not found', 400);
        if (!isWithinAcademicYear(dateKey, yearRecord)) {
          throw new ErrorResponse('Attendance date must be within the selected academic year', 400);
        }
        await assertStudentsBelongToClass(
          rows, className, academicYear, dateKey, yearRecord, session
        );

        const operations = rows.map(row => {
          const key = {
            student: row.student,
            class: className,
            date: dateBounds.start,
            subject: normalizedSubject,
            academicYear,
          };
          if (row.expectedRevision === null) {
            return {
              updateOne: {
                // A null revision means the client observed no record. If one
                // appeared since that read, do not match and overwrite it.
                filter: { ...key, _id: { $exists: false } },
                update: {
                  $setOnInsert: {
                    ...key,
                    status: row.status,
                    remarks: row.remarks,
                    markedBy: actorId(user),
                    revision: 1,
                    lastMutationId: operationId,
                  },
                },
                upsert: true,
              },
            };
          }
          return {
            updateOne: {
              filter: revisionFilter(key, row.expectedRevision),
              update: {
                $set: {
                  status: row.status,
                  remarks: row.remarks,
                  markedBy: actorId(user),
                  lastMutationId: operationId,
                },
                $inc: { revision: 1 },
              },
              upsert: false,
            },
          };
        });
        const result = await Attendance.bulkWrite(operations, { ordered: true, session });
        const matchedCount = result.matchedCount ?? result.nMatched ?? 0;
        const upsertedCount = result.upsertedCount ?? result.nUpserted ?? 0;
        if (matchedCount !== expectedUpdates || upsertedCount !== expectedInserts) {
          throw new ErrorResponse('Attendance changed after it was loaded; reload and review the whole batch', 409);
        }

        return committedResult;
      });
      logger.info(`Attendance batch committed for Class ${className} on ${dateKey} by ${actorId(user)}`);
      return committedResult;
    } catch (error) {
      if (isUnknownCommitOutcome(error)) {
        let reconciled = false;
        try {
          const reconciliationQuery = Attendance.find({ lastMutationId: operationId })
            .select('student class date subject academicYear status revision +lastMutationId')
            .read('primary')
            .readConcern('majority');
          const persisted = await reconciliationQuery;
          reconciled = persisted.length === rows.length && rows.every(row => persisted.some(record =>
            idString(record.student) === idString(row.student) &&
            record.class === className && schoolDateKey(record.date) === dateKey &&
            record.subject === normalizedSubject && record.academicYear === academicYear &&
            record.status === row.status && record.revision === (row.expectedRevision === null ? 1 : row.expectedRevision + 1)
          ));
        } catch (_) {
          reconciled = false;
        }
        if (reconciled) return committedResult;
        const unknown = new ErrorResponse(
          'Attendance transaction outcome is unknown; reload and reconcile before retrying', 503
        );
        unknown.code = 'ATTENDANCE_OUTCOME_UNKNOWN';
        unknown.operationId = operationId;
        unknown.outcome = 'unknown';
        throw unknown;
      }
      if (isDuplicateOrWriteConflict(error)) {
        throw new ErrorResponse('Attendance changed concurrently; reload and review the whole batch', 409);
      }
      if (isTransactionUnavailable(error)) {
        const unavailable = new ErrorResponse(
          'MongoDB transactions are required for attendance writes but are unavailable', 503
        );
        unavailable.code = 'ATTENDANCE_TRANSACTIONS_UNAVAILABLE';
        throw unavailable;
      }
      throw error;
    }
  }

  async getClassAttendance(className, date, academicYear, user, subject) {
    const scope = await this.assertClassReadAccess(user, className, academicYear, 'attendance.view');
    const dateKey = date === undefined || date === null || date === ''
      ? todaySchoolDate()
      : normalizeRequestedDate(date);
    const yearRecord = await AcademicYear.findOne({ name: academicYear }).select('name startDate endDate');
    if (!yearRecord) throw new ErrorResponse('Academic year not found', 404);
    if (!isWithinAcademicYear(dateKey, yearRecord)) {
      throw new ErrorResponse('Attendance date must be within the selected academic year', 400);
    }
    if (subject !== undefined && (typeof subject !== 'string' || !subject.trim())) {
      throw new ErrorResponse('Invalid attendance subject', 400);
    }
    if (subject && Array.isArray(scope.subjects) && !scope.subjects.includes(subject)) {
      throw new ErrorResponse('Access denied', 403);
    }
    const subjectValues = subject ? [subject] : scope.subjects;
    const [records, students] = await Promise.all([
      Attendance.getClassAttendance(className, dateKey, academicYear, subjectValues),
      getClassYearRoster(className, academicYear, yearRecord, dateKey, dateKey),
    ]);
    return {
      records: records.map(attendanceRecordDTO),
      students: students.map(entry => entry.student),
    };
  }

  async assertStudentAccess(studentId, user, academicYear) {
    if (!actorId(user)) throw new ErrorResponse('Not authenticated', 401);
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      throw new ErrorResponse('Attendance record not found', 404);
    }

    const student = await Student.findById(studentId)
      .select('_id user class academicYear enrollmentEffectiveFrom enrollmentHistory parentUser isActive');
    if (!student) throw new ErrorResponse('Attendance record not found', 404);

    if (TEACHER_ROLES.has(user.role)) {
      if (!academicYear || !validAcademicYear(academicYear)) {
        throw new ErrorResponse('Academic year is required', 400);
      }
      const yearRecord = await AcademicYear.findOne({ name: academicYear }).select('name startDate endDate');
      const enrollment = enrollmentSegmentsForYear(student, academicYear, yearRecord);
      if (!enrollment || !enrollment.segments.length) {
        throw new ErrorResponse('Attendance record not found', 404);
      }
      const teacherScopes = [];
      for (const segment of enrollment.segments) {
        try {
          const scope = await this.loadTeacherScope(user, segment.className, academicYear);
          teacherScopes.push({ ...segment, subjects: scope.subjects });
        } catch (error) {
          if (error.statusCode !== 403) throw error;
        }
      }
      if (!teacherScopes.length) throw new ErrorResponse('Attendance record not found', 404);
      return { student, teacherScopes, academicYearRecord: yearRecord };
    }

    if (LEADERSHIP_ROLES.has(user.role)) {
      requireActor(user, ['attendance.view']);
      return { student, subjects: null, className: academicYear && enrollmentMatches(student, String(student.class), academicYear) ? String(student.class) : undefined };
    }

    if (user.role === 'student') {
      requireActor(user, ['attendance.view-own']);
      if (idString(student.user) !== idString(actorId(user))) {
        throw new ErrorResponse('Attendance record not found', 404);
      }
      return { student, subjects: null, className: undefined };
    }

    if (user.role === 'parent') {
      requireActor(user, ['attendance.view-linked']);
      const parent = await Parent.findOne({ user: actorId(user) }).select('children');
      const childIds = (parent?.children || []).map(idString);
      const linkedThroughCurrentRelation = childIds.includes(idString(student._id));
      const linkedThroughLegacyRelation = idString(student.parentUser) === idString(actorId(user));
      if (!linkedThroughCurrentRelation && !linkedThroughLegacyRelation) {
        throw new ErrorResponse('Attendance record not found', 404);
      }
      return { student, subjects: null, className: undefined };
    }

    throw new ErrorResponse('Access denied', 403);
  }

  async getTeacherAuthorizedStudentRecords(access) {
    const { student, teacherScopes, academicYearRecord } = access;
    const yearBounds = academicYearDateKeys(academicYearRecord);
    const yearEndExclusive = incrementDateKey(yearBounds.end);
    const dateBounds = scope => ({
      $gte: schoolDayBounds(scope.start).start,
      $lt: scope.end === yearEndExclusive
        ? schoolDayBounds(yearBounds.end).end
        : schoolDayBounds(scope.end).start,
    });
    const classScopes = teacherScopes.map(scope => ({
      class: scope.className,
      date: dateBounds(scope),
      ...(scope.subjects ? { subject: { $in: scope.subjects } } : {}),
    }));
    const records = await Attendance.find({
      student: student._id,
      academicYear: academicYearRecord.name,
      $or: classScopes,
    }).select('_id student class date status subject academicYear').sort('date');
    return records.filter(record => {
      const dateKey = schoolDateKey(record.date);
      const authorized = teacherScopes.some(scope =>
        scope.className === String(record.class) &&
        scope.start <= dateKey && dateKey < scope.end &&
        (!scope.subjects || scope.subjects.includes(String(record.subject)))
      ) && enrollmentEffectiveForDate(
        student, String(record.class), academicYearRecord.name, dateKey, academicYearRecord
      );
      if (!authorized) {
        throw new ErrorResponse('Attendance records cannot be verified against effective enrollment history', 503);
      }
      return true;
    });
  }

  async getStudentAttendanceSummary(studentId, academicYear, user) {
    if (academicYear && !validAcademicYear(academicYear)) {
      throw new ErrorResponse('Invalid academic year', 400);
    }
    const access = await this.assertStudentAccess(studentId, user, academicYear);
    if (TEACHER_ROLES.has(user.role)) {
      const records = await this.getTeacherAuthorizedStudentRecords(access);
      return summarizeAttendanceRecords(records);
    }
    return Attendance.getStudentSummary(
      access.student._id,
      academicYear,
      access.className,
      access.subjects
    );
  }

  async getMonthlyAttendance(studentId, year, month, user, academicYear) {
    if (academicYear && !validAcademicYear(academicYear)) {
      throw new ErrorResponse('Invalid academic year', 400);
    }
    const access = await this.assertStudentAccess(studentId, user, academicYear);
    const currentSchoolDate = todaySchoolDate().split('-').map(Number);
    const numericYear = year === undefined || year === null || year === '' ? currentSchoolDate[0] : Number(year);
    const numericMonth = month === undefined || month === null || month === '' ? currentSchoolDate[1] : Number(month);
    if (!Number.isInteger(numericYear) || numericYear < 1900 || numericYear > 9999 ||
        !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
      throw new ErrorResponse('Valid attendance month and year are required', 400);
    }
    let bounds;
    try {
      bounds = schoolMonthBounds(numericYear, numericMonth);
    } catch (error) {
      throw new ErrorResponse(error.message, 400);
    }
    let records;
    if (TEACHER_ROLES.has(user.role)) {
      records = (await this.getTeacherAuthorizedStudentRecords(access))
        .filter(record => record.date >= bounds.start && record.date < bounds.end);
    } else {
      const filter = {
        student: access.student._id,
        date: { $gte: bounds.start, $lt: bounds.end },
      };
      if (access.className) filter.class = access.className;
      if (academicYear) filter.academicYear = academicYear;
      if (access.subjects) filter.subject = { $in: access.subjects };
      records = await Attendance.find(filter)
        .select('_id student class date status subject academicYear')
        .sort('date');
    }
    return records.map(attendanceRecordDTO);
  }

  async getClassReport(className, startDate, endDate, academicYear, user) {
    const scope = await this.assertClassReadAccess(user, className, academicYear, 'attendance.report');
    const startKey = normalizeRequestedDate(startDate, 'start date');
    const endKey = normalizeRequestedDate(endDate, 'end date');
    if (endKey < startKey) throw new ErrorResponse('End date must not precede start date', 400);
    const yearRecord = await AcademicYear.findOne({ name: academicYear }).select('name startDate endDate');
    if (!yearRecord) throw new ErrorResponse('Academic year not found', 404);
    if (!isWithinAcademicYear(startKey, yearRecord) || !isWithinAcademicYear(endKey, yearRecord)) {
      throw new ErrorResponse('Report dates must be within the selected academic year', 400);
    }
    const start = schoolDayBounds(startKey).start;
    const end = schoolDayBounds(endKey).end;

    const [roster, attendanceRecords] = await Promise.all([
      getClassYearRoster(className, academicYear, yearRecord, startKey, endKey),
      Attendance.find({
        class: className,
        academicYear,
        date: { $gte: start, $lt: end },
        ...(scope.subjects ? { subject: { $in: scope.subjects } } : {}),
      }).select('_id student class date status subject academicYear'),
    ]);

    for (const record of attendanceRecords) {
      const rosterEntry = roster.find(entry => entry.student._id === idString(record.student));
      const recordDate = schoolDateKey(record.date);
      if (!rosterEntry || !rosterEntry.periods.some(period =>
        period.start <= recordDate && recordDate < period.end
      )) {
        throw new ErrorResponse('Attendance report cannot be verified against effective enrollment history', 503);
      }
    }

    return roster.map(entry => {
      const { student, periods } = entry;
      const records = attendanceRecords.filter(record =>
        idString(record.student) === student._id && periods.some(period => {
          const recordDate = schoolDateKey(record.date);
          return period.start <= recordDate && recordDate < period.end;
        })
      );
      const present = records.filter(record => record.status === 'Present').length;
      const absent = records.filter(record => record.status === 'Absent').length;
      const late = records.filter(record => record.status === 'Late').length;
      const total = records.filter(record => record.status !== 'Holiday').length;
      return {
        student,
        present,
        absent,
        late,
        total,
        percentage: total > 0 ? Number(((present + late) / total * 100).toFixed(2)) : 0,
      };
    });
  }

  async getLowAttendanceStudents(className, academicYear, threshold = 75, user) {
    requireLeadership(user, 'attendance.report');
    if (!isValidClass(className) || !validAcademicYear(academicYear)) {
      throw new ErrorResponse('Class and academic year are required', 400);
    }
    const numericThreshold = Number(threshold);
    if (!Number.isFinite(numericThreshold) || numericThreshold < 0 || numericThreshold > 100) {
      throw new ErrorResponse('Threshold must be between 0 and 100', 400);
    }
    const yearRecord = await AcademicYear.findOne({ name: academicYear }).select('name startDate endDate');
    if (!yearRecord) throw new ErrorResponse('Academic year not found', 404);
    const roster = await getClassYearRoster(className, academicYear, yearRecord);
    const results = await Promise.all(roster.map(async entry => {
      const records = await Attendance.find({
        student: entry.student._id,
        class: className,
        academicYear,
      }).select('_id date status');
      const authorizedRecords = records.filter(record => {
        const dateKey = schoolDateKey(record.date);
        const authorized = entry.periods.some(period => period.start <= dateKey && dateKey < period.end);
        if (!authorized) {
          throw new ErrorResponse('Attendance report cannot be verified against effective enrollment history', 503);
        }
        return true;
      });
      const summary = summarizeAttendanceRecords(authorizedRecords);
      if (Number(summary.percentage) >= numericThreshold) return null;
      return { student: entry.student, summary };
    }));
    return results.filter(Boolean);
  }

  async getAttendanceReport(filters, user) {
    if (!actorId(user)) throw new ErrorResponse('Not authenticated', 401);
    const safeFilters = {};
    const className = filters?.class;
    const academicYear = filters?.academicYear;

    if (TEACHER_ROLES.has(user.role)) {
      if (!className || !academicYear) {
        throw new ErrorResponse('Class and academic year are required for teacher reports', 400);
      }
      const scope = await this.loadTeacherScope(user, className, academicYear, 'attendance.report');
      safeFilters.class = className;
      safeFilters.academicYear = academicYear;
      if (scope.subjects) safeFilters.subject = { $in: scope.subjects };
    } else {
      requireLeadership(user, 'attendance.report');
      if (className) {
        if (!isValidClass(className)) throw new ErrorResponse('Invalid class', 400);
        safeFilters.class = className;
      }
      if (academicYear) {
        if (!validAcademicYear(academicYear)) throw new ErrorResponse('Invalid academic year', 400);
        safeFilters.academicYear = academicYear;
      }
    }

    if (filters?.startDate || filters?.endDate) {
      const startKey = normalizeRequestedDate(filters.startDate, 'start date');
      const endKey = normalizeRequestedDate(filters.endDate, 'end date');
      if (endKey < startKey) throw new ErrorResponse('End date must not precede start date', 400);
      if (safeFilters.academicYear) {
        const yearRecord = await AcademicYear.findOne({ name: safeFilters.academicYear })
          .select('name startDate endDate');
        if (!yearRecord || !isWithinAcademicYear(startKey, yearRecord) || !isWithinAcademicYear(endKey, yearRecord)) {
          throw new ErrorResponse('Report dates must be within the selected academic year', 400);
        }
      }
      safeFilters.date = {
        $gte: schoolDayBounds(startKey).start,
        $lt: schoolDayBounds(endKey).end,
      };
    }
    if (filters?.status) {
      if (!['Present', 'Absent', 'Late', 'Half-Day', 'Leave', 'Holiday'].includes(filters.status)) {
        throw new ErrorResponse('Invalid attendance status', 400);
      }
      safeFilters.status = filters.status;
    }

    if (TEACHER_ROLES.has(user.role)) {
      const yearRecord = await AcademicYear.findOne({ name: safeFilters.academicYear })
        .select('name startDate endDate');
      if (!yearRecord) throw new ErrorResponse('Academic year not found', 404);
      const records = await Attendance.find(safeFilters)
        .select('_id student class date status subject academicYear');
      const studentIds = [...new Set(records.map(record => idString(record.student)))];
      const students = studentIds.length
        ? await Student.find({ _id: { $in: studentIds } })
          .select('_id class academicYear enrollmentEffectiveFrom enrollmentHistory')
        : [];
      const studentById = new Map(students.map(student => [idString(student._id), student]));
      const counts = new Map();
      for (const record of records) {
        const student = studentById.get(idString(record.student));
        const dateKey = schoolDateKey(record.date);
        if (!student || !isWithinAcademicYear(dateKey, yearRecord) ||
            !enrollmentEffectiveForDate(student, String(record.class), safeFilters.academicYear, dateKey, yearRecord)) {
          throw new ErrorResponse('Attendance report cannot be verified against effective enrollment history', 503);
        }
        counts.set(record.status, (counts.get(record.status) || 0) + 1);
      }
      return [...counts.entries()].map(([_id, count]) => ({ _id, count }));
    }

    return Attendance.aggregate([
      { $match: safeFilters },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
  }

  async updateAttendance(id, updateData, user) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ErrorResponse('Attendance record not found', 404);
    }
    if (!updateData || typeof updateData !== 'object' || Array.isArray(updateData) ||
        !UPDATE_STATUSES.has(updateData.status)) {
      throw new ErrorResponse('Invalid attendance status', 400);
    }
    if (!Object.prototype.hasOwnProperty.call(updateData, 'expectedRevision')) {
      throw new ErrorResponse('expectedRevision is required', 400);
    }
    const requestedRevision = expectedRevision(updateData.expectedRevision);
    if (requestedRevision === null) throw new ErrorResponse('An existing attendance record requires a numeric revision', 400);

    requireWriteActor(user, 'attendance.edit-authorized');
    requireSharedAttendanceConnection();
    await requireLogicalUniqueIndex();
    const operationId = crypto.randomUUID();
    let expectedIdentity;
    let transactionResult;
    try {
      transactionResult = await runAttendanceTransaction(async session => {
        const existingQuery = Attendance.findById(id)
          .select('_id student class subject academicYear date status remarks revision');
        const existing = await useSession(existingQuery, session);
        if (!existing) throw new ErrorResponse('Attendance record not found', 404);
        expectedIdentity = {
          student: idString(existing.student),
          class: existing.class,
          subject: existing.subject,
          academicYear: existing.academicYear,
          date: schoolDateKey(existing.date),
        };
        const storedRevision = Number.isSafeInteger(existing.revision) ? existing.revision : 0;
        if (storedRevision !== requestedRevision) {
          throw new ErrorResponse('Attendance changed after it was loaded; reload and review before updating', 409);
        }

        await this.assertTeacherAssignment(
          user,
          existing.class,
          existing.subject,
          existing.academicYear,
          'attendance.edit-authorized',
          session
        );
        const yearQuery = AcademicYear.findOne({ name: existing.academicYear })
          .select('name startDate endDate');
        const yearRecord = await useSession(yearQuery, session);
        if (!yearRecord) throw new ErrorResponse('Academic year not found', 400);
        const dateKey = schoolDateKey(existing.date);
        if (!isWithinAcademicYear(dateKey, yearRecord)) {
          throw new ErrorResponse('Attendance date is outside its academic year', 409);
        }
        const studentQuery = Student.findById(existing.student)
          .select('_id class academicYear enrollmentEffectiveFrom enrollmentHistory');
        const student = await useSession(studentQuery, session);
        if (!student || !enrollmentEffectiveForDate(
          student, existing.class, existing.academicYear, dateKey, yearRecord
        )) {
          throw new ErrorResponse('Attendance enrollment is missing, ambiguous, or not effective on the record date', 403);
        }

        const updateQuery = Attendance.findOneAndUpdate(
          revisionFilter({ _id: id }, requestedRevision),
          {
            $set: {
              status: updateData.status,
              remarks: typeof updateData.remarks === 'string' ? updateData.remarks : '',
              markedBy: actorId(user),
              lastMutationId: operationId,
            },
            $inc: { revision: 1 },
          },
          { new: true, runValidators: true, session }
        );
        const updated = await updateQuery;
        if (!updated) throw new ErrorResponse('Attendance changed concurrently; reload and review before updating', 409);
        return attendanceRecordDTO(updated);
      });
      return transactionResult;
    } catch (error) {
      if (isUnknownCommitOutcome(error)) {
        let reconciledRecord = null;
        try {
          const reconciliationQuery = Attendance.findOne({ _id: id, lastMutationId: operationId })
            .select('_id student class subject academicYear date status remarks revision +lastMutationId')
            .read('primary')
            .readConcern('majority');
          reconciledRecord = await reconciliationQuery;
        } catch (_) {
          reconciledRecord = null;
        }
        if (reconciledRecord &&
            idString(reconciledRecord._id) === idString(id) &&
            expectedIdentity &&
            idString(reconciledRecord.student) === expectedIdentity.student &&
            reconciledRecord.class === expectedIdentity.class &&
            reconciledRecord.subject === expectedIdentity.subject &&
            reconciledRecord.academicYear === expectedIdentity.academicYear &&
            schoolDateKey(reconciledRecord.date) === expectedIdentity.date &&
            reconciledRecord.revision === requestedRevision + 1 &&
            reconciledRecord.status === updateData.status &&
            reconciledRecord.remarks === (typeof updateData.remarks === 'string' ? updateData.remarks : '')) {
          return attendanceRecordDTO(reconciledRecord);
        }
        const unknown = new ErrorResponse(
          'Attendance update outcome is unknown; reload and reconcile before retrying', 503
        );
        unknown.code = 'ATTENDANCE_OUTCOME_UNKNOWN';
        unknown.operationId = operationId;
        unknown.outcome = 'unknown';
        throw unknown;
      }
      if (isDuplicateOrWriteConflict(error)) {
        throw new ErrorResponse('Attendance changed concurrently; reload and review before updating', 409);
      }
      if (isTransactionUnavailable(error)) {
        const unavailable = new ErrorResponse(
          'MongoDB transactions are required for attendance updates but are unavailable', 503
        );
        unavailable.code = 'ATTENDANCE_TRANSACTIONS_UNAVAILABLE';
        throw unavailable;
      }
      throw error;
    }
  }
}

module.exports = new AttendanceService();
