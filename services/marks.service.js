const mongoose = require('mongoose');
const Marks = require('../models/Marks');
const Exam = require('../models/Exam');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');
const Subject = require('../models/Subject');
const SubjectAllocation = require('../models/SubjectAllocation');
const ErrorResponse = require('../utils/errorResponse');
const { publishedExamFilter } = require('../utils/exam-visibility');

const TEACHER_ROLES = new Set(['teacher', 'class_teacher', 'faculty']);
const MANAGER_ROLES = new Set(['super_admin', 'school_admin', 'admin', 'principal', 'exam_coordinator']);
const ALLOWED_FIELDS = new Set(['student', 'class', 'academicYear', 'examType', 'subjects', 'examDate', 'remarks']);
const ALLOWED_SUBJECT_FIELDS = new Set(['subject', 'maxMarks', 'marksObtained', 'isAbsent', 'remarks']);

function idString(value) {
  return String(value && value._id ? value._id : value);
}

function parseFiniteNumber(value, field) {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && !value.trim())) {
    throw new ErrorResponse(`${field} must be a valid number`, 400);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ErrorResponse(`${field} must be a valid number`, 400);
  return number;
}

function normalizedText(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

async function resolveSubject(value, classLevel) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ErrorResponse('Each marks subject must identify an active subject', 400);
  }
  const candidate = value.trim();
  const query = { isActive: true };
  if (mongoose.isValidObjectId(candidate)) query._id = candidate;
  else query.$or = [{ name: candidate }, { code: candidate.toUpperCase() }];
  const subject = await Subject.findOne(query);
  if (!subject) throw new ErrorResponse(`Subject '${candidate}' was not found or is inactive`, 400);
  if (subject.classLevels?.length && !subject.classLevels.includes(classLevel)) {
    throw new ErrorResponse(`Subject '${candidate}' is not offered in class ${classLevel}`, 403);
  }
  return subject;
}

function findScheduledSubject(exam, subject, suppliedValue) {
  const accepted = new Set([
    normalizedText(subject.name),
    normalizedText(subject.code),
    normalizedText(subject._id),
    normalizedText(suppliedValue),
  ].filter(Boolean));
  return (exam.subjects || []).find((entry) => {
    const value = entry?.subject && typeof entry.subject === 'object'
      ? entry.subject.name || entry.subject.code || entry.subject._id
      : entry?.subject;
    return accepted.has(normalizedText(value));
  });
}

function serializeMark(subjectMark) {
  return typeof subjectMark?.toObject === 'function' ? subjectMark.toObject() : { ...subjectMark };
}

exports.addOrUpdateMarks = async (data, user) => {
  if (!user || !user._id) throw new ErrorResponse('Not authenticated', 401);
  const role = String(user.role || '').toLowerCase();
  if (!TEACHER_ROLES.has(role) && !MANAGER_ROLES.has(role)) {
    throw new ErrorResponse('Role is not authorized to enter marks', 403);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErrorResponse('Invalid marks data', 400);
  }
  if (Object.keys(data).some((field) => !ALLOWED_FIELDS.has(field))) {
    throw new ErrorResponse('Unexpected marks field', 400);
  }
  if (!data.student || !mongoose.isValidObjectId(data.student)) {
    throw new ErrorResponse('A valid student is required', 400);
  }
  if (typeof data.class !== 'string' || !data.class.trim()
    || typeof data.academicYear !== 'string' || !/^\d{4}-\d{4}$/.test(data.academicYear)
    || typeof data.examType !== 'string' || !data.examType.trim()
    || !Array.isArray(data.subjects) || !data.subjects.length) {
    throw new ErrorResponse('Class, academic year, exam type, and subjects are required', 400);
  }
  const examTypeValues = Marks.schema.path('examType')?.enumValues || [];
  if (!examTypeValues.includes(data.examType)) {
    throw new ErrorResponse('Exam type is not supported by the marks record', 400);
  }

  const student = await Student.findOne({ _id: data.student, isActive: { $ne: false } })
    .select('_id class academicYear');
  if (!student) throw new ErrorResponse('Student not found', 404);
  if (student.class !== data.class || student.academicYear !== data.academicYear) {
    throw new ErrorResponse('Marks class and academic year must match the student enrollment', 403);
  }

  const examFilter = {
    class: student.class,
    academicYear: student.academicYear,
    examType: data.examType,
    isActive: { $ne: false },
  };
  if (TEACHER_ROLES.has(role)) {
    examFilter.status = publishedExamFilter().status;
  }
  const exams = await Exam.find(examFilter);
  if (!exams.length) throw new ErrorResponse('No active exam matches this class, year, and exam type', 404);
  if (exams.length > 1) throw new ErrorResponse('More than one active exam matches this marks record; resolve the exam schedule before entering marks', 409);
  const exam = exams[0];

  const sanitizedSubjects = [];
  const subjectIds = new Set();
  let faculty;
  if (TEACHER_ROLES.has(role)) {
    faculty = await Faculty.findOne({ user: user._id, isActive: { $ne: false } }).select('_id');
    if (!faculty) throw new ErrorResponse('Teacher profile not found', 404);
  }

  for (const supplied of data.subjects) {
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)
      || Object.keys(supplied).some((field) => !ALLOWED_SUBJECT_FIELDS.has(field))) {
      throw new ErrorResponse('Invalid subject marks entry', 400);
    }
    const subject = await resolveSubject(supplied.subject, student.class);
    const subjectId = idString(subject._id);
    if (subjectIds.has(subjectId)) throw new ErrorResponse('A subject may appear only once per marks record', 400);
    subjectIds.add(subjectId);

    const scheduledSubject = findScheduledSubject(exam, subject, supplied.subject);
    if (!scheduledSubject) throw new ErrorResponse(`Subject '${subject.name}' is not included in this exam`, 400);

    if (TEACHER_ROLES.has(role)) {
      const assignment = await SubjectAllocation.findOne({
        teacher: faculty._id,
        subject: subject._id,
        class: student.class,
        academicYear: student.academicYear,
      }).select('_id');
      if (!assignment) throw new ErrorResponse('Teacher is not assigned to this subject, class, and academic year', 403);
    }

    const scheduledMax = scheduledSubject.maxMarks;
    const hasScheduledMax = scheduledMax !== undefined && scheduledMax !== null;
    // Preserve the Marks subdocument's existing 100-point default when no exam maximum is configured.
    const maxMarks = supplied.maxMarks === undefined
      ? (hasScheduledMax ? Number(scheduledMax) : 100)
      : parseFiniteNumber(supplied.maxMarks, 'Maximum marks');
    if (!Number.isFinite(maxMarks) || maxMarks <= 0) {
      throw new ErrorResponse('Maximum marks must be a positive finite number', 400);
    }
    if (hasScheduledMax && (!Number.isFinite(Number(scheduledMax)) || Number(scheduledMax) <= 0
      || Math.abs(maxMarks - Number(scheduledMax)) > 0.000001)) {
      throw new ErrorResponse('Maximum marks must match the exam schedule', 400);
    }

    if (supplied.isAbsent !== undefined && typeof supplied.isAbsent !== 'boolean') {
      throw new ErrorResponse('Absent status must be a boolean', 400);
    }
    const isAbsent = supplied.isAbsent === true;
    const marksObtained = isAbsent
      ? (supplied.marksObtained === undefined ? 0 : parseFiniteNumber(supplied.marksObtained, 'Obtained marks'))
      : parseFiniteNumber(supplied.marksObtained, 'Obtained marks');
    if (!Number.isFinite(marksObtained) || marksObtained < 0 || marksObtained > maxMarks
      || (isAbsent && marksObtained !== 0)) {
      throw new ErrorResponse('Obtained marks must be between zero and the maximum marks', 400);
    }
    if (supplied.remarks !== undefined && typeof supplied.remarks !== 'string') {
      throw new ErrorResponse('Subject remarks must be text', 400);
    }

    sanitizedSubjects.push({
      subject: subject.name,
      maxMarks,
      marksObtained,
      isAbsent,
      ...(supplied.remarks !== undefined ? { remarks: supplied.remarks.slice(0, 1000) } : {}),
    });
  }

  let suppliedExamDate;
  if (data.examDate !== undefined) {
    if ((typeof data.examDate !== 'string' && !(data.examDate instanceof Date))
      || (typeof data.examDate === 'string' && !data.examDate.trim())) {
      throw new ErrorResponse('Exam date is invalid', 400);
    }
    suppliedExamDate = new Date(data.examDate);
    if (!Number.isFinite(suppliedExamDate.getTime())) throw new ErrorResponse('Exam date is invalid', 400);
  }

  const existing = await Marks.findOne({
    student: student._id,
    examType: data.examType,
    academicYear: student.academicYear,
  });
  if (existing && existing.isPublished) throw new ErrorResponse('Published marks cannot be changed', 409);
  if (existing && existing.class !== student.class) {
    throw new ErrorResponse('Existing marks belong to a different class enrollment', 409);
  }
  if (existing && TEACHER_ROLES.has(role) && idString(existing.markedBy) !== idString(user._id)) {
    throw new ErrorResponse('Teacher may update only marks records they entered', 403);
  }

  const record = existing || new Marks();
  const existingSubjects = Array.isArray(record.subjects) ? record.subjects.map(serializeMark) : [];
  const existingByName = new Set();
  for (const existingSubject of existingSubjects) {
    const key = normalizedText(existingSubject.subject);
    if (existingByName.has(key)) throw new ErrorResponse('Existing marks contain duplicate subjects and require review', 409);
    existingByName.add(key);
  }
  const updates = new Map(sanitizedSubjects.map((subject) => [normalizedText(subject.subject), subject]));
  const mergedSubjects = existingSubjects.map((subject) => {
    const key = normalizedText(subject.subject);
    if (!updates.has(key)) return subject;
    const update = updates.get(key);
    updates.delete(key);
    return { ...subject, ...update };
  });
  mergedSubjects.push(...updates.values());

  record.student = student._id;
  record.class = student.class;
  record.academicYear = student.academicYear;
  record.examType = data.examType;
  record.subjects = mergedSubjects;
  const scheduledDate = sanitizedSubjects
    .map((mark) => findScheduledSubject(exam, { name: mark.subject }, mark.subject)?.date)
    .find((date) => date !== undefined && date !== null) || exam.startDate;
  if (scheduledDate) {
    if (suppliedExamDate && new Date(scheduledDate).getTime() !== suppliedExamDate.getTime()) {
      throw new ErrorResponse('Exam date must match the exam schedule', 400);
    }
    record.examDate = scheduledDate;
  } else if (suppliedExamDate) {
    record.examDate = suppliedExamDate;
  }
  if (data.remarks !== undefined) {
    if (typeof data.remarks !== 'string') throw new ErrorResponse('Marks remarks must be text', 400);
    record.remarks = data.remarks.slice(0, 1000);
  }
  record.markedBy = user._id;
  record.isPublished = false;
  record.publishedAt = undefined;
  record.publishedBy = undefined;

  try {
    await record.save();
  } catch (error) {
    if (error?.code === 11000) throw new ErrorResponse('Marks already exist for this student, exam, and academic year', 409);
    if (error?.name === 'VersionError') {
      throw new ErrorResponse('Marks changed while this update was being saved. Reload the current record and retry your change.', 409);
    }
    throw error;
  }
  return { record, created: !existing };
};
