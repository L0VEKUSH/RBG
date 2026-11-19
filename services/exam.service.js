const Exam = require('../models/Exam');
const Class = require('../models/Class');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const Faculty = require('../models/Faculty');
const SubjectAllocation = require('../models/SubjectAllocation');
const { getRolePermissions } = require('../config/permissions');
const ErrorResponse = require('../utils/errorResponse');
const { isValidAcademicYear } = require('../utils/academic-year');
const { publishedExamFilter, isPublishedExam } = require('../utils/exam-visibility');
const { assertIndexesPresent } = require('../utils/mongoose-index-policy');

const TEACHER_ROLES = new Set(['teacher', 'class_teacher', 'faculty']);
const EXAM_FIELDS = new Set([
  'name', 'examType', 'class', 'academicYear', 'startDate', 'endDate',
  'subjects', 'instructions', 'status', 'isActive',
]);
const EXAM_SUBJECT_FIELDS = new Set(['subject', 'date', 'startTime', 'endTime', 'room', 'maxMarks']);
const EXAM_STATUSES = new Set(['Draft', 'Scheduled', 'Ongoing', 'Completed', 'ResultPublished']);
const CLASS_LEVELS = new Set([
  'Pre-Nursery', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
]);

function sanitizeExamSchedule(data, { creating = false } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErrorResponse('Invalid exam schedule', 400);
  }
  if (Object.keys(data).some(field => !EXAM_FIELDS.has(field))) {
    throw new ErrorResponse('Exam schedule contains an unsupported field', 400);
  }

  const schedule = {};
  for (const field of EXAM_FIELDS) {
    if (data[field] !== undefined) schedule[field] = data[field];
  }

  if (schedule.name !== undefined) {
    if (typeof schedule.name !== 'string' || !schedule.name.trim()) {
      throw new ErrorResponse('Exam name is required', 400);
    }
    schedule.name = schedule.name.trim();
  }
  if (schedule.class !== undefined && !CLASS_LEVELS.has(schedule.class)) {
    throw new ErrorResponse('Choose a valid exam class', 400);
  }
  if (schedule.academicYear !== undefined) {
    const match = /^(\d{4})-(\d{4})$/.exec(schedule.academicYear);
    if (!match || Number(match[2]) !== Number(match[1]) + 1) {
      throw new ErrorResponse('Academic year must use consecutive YYYY-YYYY dates', 400);
    }
  }
  if (schedule.examType !== undefined &&
      (typeof schedule.examType !== 'string' || !schedule.examType.trim())) {
    throw new ErrorResponse('Exam type is required', 400);
  }
  if (schedule.status !== undefined && !EXAM_STATUSES.has(schedule.status)) {
    throw new ErrorResponse('Choose a valid exam status', 400);
  }
  if (schedule.isActive !== undefined && typeof schedule.isActive !== 'boolean') {
    throw new ErrorResponse('Exam active status must be a boolean', 400);
  }

  for (const field of ['startDate', 'endDate']) {
    if (schedule[field] === undefined) continue;
    const value = new Date(schedule[field]);
    if (!Number.isFinite(value.getTime())) throw new ErrorResponse(`${field} is invalid`, 400);
    schedule[field] = value;
  }
  if (schedule.startDate && schedule.endDate && schedule.startDate > schedule.endDate) {
    throw new ErrorResponse('Exam end date must not be before its start date', 400);
  }

  if (schedule.subjects !== undefined) {
    if (!Array.isArray(schedule.subjects)) throw new ErrorResponse('Exam subjects must be a list', 400);
    schedule.subjects = schedule.subjects.map(subject => {
      if (!subject || typeof subject !== 'object' || Array.isArray(subject) ||
          Object.keys(subject).some(field => !EXAM_SUBJECT_FIELDS.has(field))) {
        throw new ErrorResponse('Exam subject contains an unsupported field', 400);
      }
      if (typeof subject.subject !== 'string' || !subject.subject.trim()) {
        throw new ErrorResponse('Each exam subject needs a name', 400);
      }
      const clean = { subject: subject.subject.trim() };
      for (const field of ['date', 'startTime', 'endTime', 'room']) {
        if (subject[field] === undefined || subject[field] === '') continue;
        clean[field] = subject[field];
      }
      if (subject.date !== undefined && subject.date !== '') {
        clean.date = new Date(subject.date);
        if (!Number.isFinite(clean.date.getTime())) throw new ErrorResponse('Exam subject date is invalid', 400);
      }
      if (subject.maxMarks !== undefined && subject.maxMarks !== '') {
        clean.maxMarks = Number(subject.maxMarks);
        if (!Number.isFinite(clean.maxMarks) || clean.maxMarks <= 0) {
          throw new ErrorResponse('Subject maximum marks must be positive', 400);
        }
      }
      return clean;
    });
  }

  if (creating && (!schedule.name || !schedule.examType || !schedule.class || !schedule.academicYear ||
      !Array.isArray(schedule.subjects) || schedule.subjects.length === 0)) {
    throw new ErrorResponse('Name, type, class, academic year, and at least one subject are required', 400);
  }
  if (schedule.instructions !== undefined && typeof schedule.instructions !== 'string') {
    throw new ErrorResponse('Exam instructions must be text', 400);
  }
  return schedule;
}

function actorId(user) {
  return user?._id || user?.id;
}

async function getActorScopes(user) {
  const role = String(user?.role || '').toLowerCase();
  const userId = actorId(user);
  if (!userId) return [];

  if (role === 'student') {
    const student = await Student.findOne({ user: userId, isActive: { $ne: false } })
      .select('class academicYear');
    return student && CLASS_LEVELS.has(student.class) && isValidAcademicYear(student.academicYear)
      ? [{ class: student.class, academicYear: student.academicYear }]
      : [];
  }

  if (role === 'parent') {
    const parent = await Parent.findOne({ user: userId }).select('children');
    const childIds = Array.isArray(parent?.children) ? parent.children : [];
    const children = await Student.find({
      isActive: { $ne: false },
      $or: [{ _id: { $in: childIds } }, { parentUser: userId }],
    }).select('class academicYear');
    return children
      .filter(child => CLASS_LEVELS.has(child.class) && isValidAcademicYear(child.academicYear))
      .map((child) => ({ class: child.class, academicYear: child.academicYear }));
  }

  if (TEACHER_ROLES.has(role)) {
    const faculty = await Faculty.findOne({ user: userId, isActive: { $ne: false } }).select('_id classTeacherOf');
    if (!faculty) return [];
    const assignments = await SubjectAllocation.find({ teacher: faculty._id })
      .select('class academicYear subject')
      .populate('subject', '_id name code');
    const scopes = assignments
      .filter(({ class: className, academicYear, subject }) =>
        CLASS_LEVELS.has(className) && Boolean(subject) && isValidAcademicYear(academicYear))
      .map(({ class: className, academicYear, subject }) => ({
      class: className,
      academicYear,
      subjects: subject ? [subject.name, subject.code, subject._id].filter(Boolean).map(String) : [],
    }));
    if (CLASS_LEVELS.has(faculty.classTeacherOf?.class)
        && isValidAcademicYear(faculty.classTeacherOf?.academicYear)) {
      scopes.push({
        class: faculty.classTeacherOf.class,
        academicYear: faculty.classTeacherOf.academicYear,
        allSubjects: true,
      });
    }
    return scopes;
  }

  return [];
}

function scopeClause(scopes, classFilter, yearFilter) {
  const pairs = scopes
    .filter((scope) => CLASS_LEVELS.has(scope.class) && isValidAcademicYear(scope.academicYear)
      && (!classFilter || scope.class === classFilter)
      && (!yearFilter || scope.academicYear === yearFilter))
    .map((scope) => ({ class: scope.class, academicYear: scope.academicYear }));
  if (!pairs.length) return null;
  return pairs.length === 1 ? pairs[0] : { $or: pairs };
}

function normalizedSubject(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function examSubjectKey(subject) {
  if (typeof subject === 'string') return normalizedSubject(subject);
  if (!subject || typeof subject !== 'object') return '';
  return normalizedSubject(subject.name || subject.code || subject._id);
}

function filterTeacherExamSubjects(exams, scopes) {
  const visible = [];
  for (const exam of exams) {
    const matchingScopes = scopes.filter(scope =>
      scope.class === exam.class && scope.academicYear === exam.academicYear
    );
    if (!matchingScopes.length) continue;
    if (matchingScopes.some(scope => scope.allSubjects)) {
      visible.push(exam);
      continue;
    }
    const allowedSubjects = new Set(matchingScopes.flatMap(scope => scope.subjects || []).map(normalizedSubject));
    const plainExam = typeof exam.toObject === 'function' ? exam.toObject() : { ...exam };
    plainExam.subjects = (exam.subjects || []).filter(subject => allowedSubjects.has(examSubjectKey(subject)));
    if (plainExam.subjects.length) visible.push(plainExam);
  }
  return visible;
}

function recipientExamFilter(user) {
  const role = String(user?.role || '').toLowerCase();
  return ['student', 'parent'].includes(role) || TEACHER_ROLES.has(role)
    ? publishedExamFilter()
    : null;
}

function applyRecipientFilter(scope, user) {
  const recipientFilter = recipientExamFilter(user);
  return recipientFilter ? { $and: [scope, recipientFilter] } : scope;
}

function applyTeacherSubjectScope(exams, user, scopes) {
  return TEACHER_ROLES.has(String(user?.role || '').toLowerCase())
    ? filterTeacherExamSubjects(exams, scopes)
    : exams;
}

async function requireExistingClassYear(className, academicYear) {
  const classRecord = await Class.findOne({ name: className, academicYear });
  if (!classRecord) throw new ErrorResponse('Choose a class and academic year that exist in school records', 400);
}

async function requireUniqueExamType(className, academicYear, examType, excludeId) {
  const filter = { class: className, academicYear, examType };
  if (excludeId) filter._id = { $ne: excludeId };
  if (await Exam.exists(filter)) {
    throw new ErrorResponse('An exam schedule with this type already exists for the class and academic year', 409);
  }
}

async function requireExamTypeUniqueIndex() {
  if (process.env.NODE_ENV !== 'production') return;
  await assertIndexesPresent(Exam, [[
    { class: 1, academicYear: 1, examType: 1 },
    { unique: true },
  ]]);
}

function throwExamScheduleConflict(error) {
  if (error?.code === 11000) {
    throw new ErrorResponse('An exam schedule with this type already exists for the class and academic year', 409);
  }
  throw error;
}

async function buildExamQuery(user, classFilter, yearFilter) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'super_admin') {
    return {
      ...(classFilter ? { class: classFilter } : {}),
      ...(yearFilter ? { academicYear: yearFilter } : {}),
    };
  }

  // Teacher schedule reads remain assignment-scoped even if an override grants exams.view.
  if (TEACHER_ROLES.has(role)) {
    const scope = scopeClause(await getActorScopes(user), classFilter, yearFilter);
    return scope ? { ...scope } : null;
  }

  if (role !== 'student') {
    const permissions = new Set(getRolePermissions(role));
    for (const permission of Array.isArray(user?.permissions) ? user.permissions : []) {
      if (typeof permission !== 'string') continue;
      if (permission.startsWith('-')) permissions.delete(permission.slice(1));
      else permissions.add(permission);
    }
    if (permissions.has('exams.view') || permissions.has('*')) {
      return {
        ...(classFilter ? { class: classFilter } : {}),
        ...(yearFilter ? { academicYear: yearFilter } : {}),
      };
    }
  }

  const scopes = await getActorScopes(user);
  const scope = scopeClause(scopes, classFilter, yearFilter);
  return scope ? { ...scope } : null;
}

exports.getAllExams = async (user, filters = {}) => {
  const scope = await buildExamQuery(user, filters.class, filters.academicYear);
  if (scope === null) return [];
  const exams = await Exam.find(applyRecipientFilter(scope, user)).sort({ startDate: 1, name: 1 });
  const scopes = TEACHER_ROLES.has(String(user?.role || '').toLowerCase()) ? await getActorScopes(user) : [];
  return applyTeacherSubjectScope(exams, user, scopes);
};

exports.createExam = async (data, createdBy) => {
  const schedule = sanitizeExamSchedule(data, { creating: true });
  await requireExistingClassYear(schedule.class, schedule.academicYear);
  await requireExamTypeUniqueIndex();
  await requireUniqueExamType(schedule.class, schedule.academicYear, schedule.examType);
  try {
    return await Exam.create({ ...schedule, createdBy });
  } catch (error) {
    throwExamScheduleConflict(error);
  }
};

exports.getUpcomingExams = async (user, filters = {}) => {
  const scope = await buildExamQuery(user, filters.class, filters.academicYear);
  if (scope === null) return [];

  const now = new Date();
  const dateFilter = {
    $or: [
      { startDate: { $gte: now } },
      { endDate: { $gte: now } },
      { 'subjects.date': { $gte: now } },
    ],
  };
  const recipientFilter = recipientExamFilter(user) || { isActive: { $ne: false } };
  const exams = await Exam.find({ $and: [scope, recipientFilter, dateFilter] }).sort({ startDate: 1, name: 1 });
  const scopes = TEACHER_ROLES.has(String(user?.role || '').toLowerCase()) ? await getActorScopes(user) : [];
  return applyTeacherSubjectScope(exams, user, scopes);
};

exports.getExamsByClass = async (classLevel, academicYear, user) => {
  const scope = await buildExamQuery(user, classLevel, academicYear);
  if (scope === null) return [];
  const exams = await Exam.find(applyRecipientFilter(scope, user)).sort({ startDate: 1, name: 1 });
  const scopes = TEACHER_ROLES.has(String(user?.role || '').toLowerCase()) ? await getActorScopes(user) : [];
  return applyTeacherSubjectScope(exams, user, scopes);
};

exports.getExamById = async (id, user) => {
  const exam = await Exam.findById(id);
  if (!exam) return null;
  const recipientFilter = recipientExamFilter(user);
  if (recipientFilter && !isPublishedExam(exam)) return null;
  const scope = await buildExamQuery(user, exam.class, exam.academicYear);
  if (scope === null) return null;
  if (TEACHER_ROLES.has(String(user?.role || '').toLowerCase())) {
    const scopes = await getActorScopes(user);
    return filterTeacherExamSubjects([exam], scopes)[0] || null;
  }
  return exam;
};

exports.updateExam = async (id, data) => {
  const schedule = sanitizeExamSchedule(data);
  const current = await Exam.findById(id);
  if (!current) return null;
  const className = schedule.class || current.class;
  const academicYear = schedule.academicYear || current.academicYear;
  const examType = schedule.examType || current.examType;
  await requireExistingClassYear(className, academicYear);
  await requireExamTypeUniqueIndex();
  await requireUniqueExamType(className, academicYear, examType, id);
  try {
    return await Exam.findByIdAndUpdate(id, schedule, { new: true, runValidators: true, strict: true });
  } catch (error) {
    throwExamScheduleConflict(error);
  }
};

exports.deleteExam = async (id) => Exam.findByIdAndDelete(id);
