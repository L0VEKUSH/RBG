'use strict';

const mongoose = require('mongoose');
const AcademicYear = require('../models/AcademicYear');
const RolloverExecution = require('../models/RolloverExecution');
const Student = require('../models/Student');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Class = require('../models/Class');
const ErrorResponse = require('../utils/errorResponse');
const {
  parseSchoolDate, schoolDateKey, schoolDayBounds, nextSchoolDate, isWithinAcademicYear,
} = require('../utils/attendance-date');

const ACTIONS = new Set(['pending', 'promote', 'continue', 'graduate', 'withdraw', 'transfer', 'leave_unchanged']);
const PROMOTION_CLASS_MAP = Object.freeze({
  Nursery: 'LKG', LKG: 'UKG', UKG: '1',
  '1': '2', '2': '3', '3': '4', '4': '5', '5': '6',
  '6': '7', '7': '8', '8': '9', '9': '10', '10': '11', '11': '12',
});

function isTransactionUnsupported(error) {
  return error && (
    error.code === 20 ||
    error.codeName === 'IllegalOperation' ||
    /transaction numbers are only allowed|transactions are not supported|does not support transactions|replica set/i.test(error.message || '')
  );
}

function actorId(actor) {
  const id = actor && (actor._id || actor.id);
  if (!id || !mongoose.isValidObjectId(id)) {
    throw new ErrorResponse('An authenticated administrator is required for rollover operations', 401);
  }
  return id;
}

async function findYear(name, session) {
  const query = AcademicYear.findOne({ name });
  if (session) query.session(session);
  return query;
}

async function requireYears(sourceName, destinationName, session) {
  if (sourceName === destinationName) {
    throw new ErrorResponse('Source and destination academic years must be different', 400);
  }
  const source = await findYear(sourceName, session);
  const destination = await findYear(destinationName, session);
  if (!source) throw new ErrorResponse(`Source academic year '${sourceName}' not found`, 404);
  if (!destination) throw new ErrorResponse(`Destination academic year '${destinationName}' not found`, 404);
  if (source.isCurrent !== true || source.isActive !== true) {
    throw new ErrorResponse('The source academic year must be the current active year', 409);
  }
  if (destination.isActive !== true || destination.isCurrent === true) {
    throw new ErrorResponse('The destination academic year must be active and not current', 409);
  }
  try {
    if (schoolDateKey(destination.startDate) <= schoolDateKey(source.startDate)) {
      throw new ErrorResponse('The destination academic year must start after the source year', 409);
    }
    if (!isWithinAcademicYear(schoolDateKey(destination.startDate), destination)) {
      throw new ErrorResponse('The destination academic year has invalid date boundaries', 409);
    }
  } catch (error) {
    if (error.isOperational) throw error;
    throw new ErrorResponse('Academic year has invalid date boundaries', 409);
  }
  return { source, destination };
}

function normalizeEffectiveDate(value, label) {
  try {
    const stringValue = value instanceof Date ? schoolDateKey(value) : value;
    return parseSchoolDate(stringValue, label).value;
  } catch (error) {
    throw new ErrorResponse(error.message, 400);
  }
}

function validateDecision(decision, source, destination) {
  if (!decision || typeof decision !== 'object') {
    throw new ErrorResponse('Each rollover decision must be an object', 400);
  }
  const { action } = decision;
  if (!ACTIONS.has(action)) throw new ErrorResponse(`Unsupported rollover action '${action}'`, 400);
  if (action === 'pending') return { action };
  if (decision.currentAcademicYear !== source.name) {
    throw new ErrorResponse('Decision snapshot does not match the source academic year', 409);
  }
  if (action === 'leave_unchanged') {
    return { action };
  }
  if (decision.currentTcIssued === true || decision.currentIsActive !== true) {
    throw new ErrorResponse('Inactive or TC-issued students cannot receive this rollover action', 409);
  }
  let normalizedClass;
  try {
    normalizedClass = Class.validateAndNormalizeClassWrite(decision.currentClass, 'student class');
  } catch (error) {
    throw new ErrorResponse(error.message, 400);
  }
  if (action === 'promote' && !PROMOTION_CLASS_MAP[normalizedClass]) {
    throw new ErrorResponse('Class 12 and non-promotable classes cannot be promoted', 400);
  }
  if (action === 'graduate' && normalizedClass !== '12') {
    throw new ErrorResponse('Only Class 12 students can be graduated', 400);
  }
  if (['graduate', 'withdraw', 'transfer'].includes(action)) {
    if (!decision.effectiveDate) {
      throw new ErrorResponse(`${action} requires an effectiveDate`, 400);
    }
    const normalizedDate = normalizeEffectiveDate(decision.effectiveDate, `${action} effective date`);
    const dateKey = schoolDateKey(normalizedDate);
    if (!isWithinAcademicYear(dateKey, source)) {
      throw new ErrorResponse(
        `${action} effective date must fall within the source academic year (${source.name})`,
        400
      );
    }
    return { action, effectiveDate: normalizedDate };
  }
  return { action };
}

function historyEntry(student, endDate) {
  return {
    class: student.class,
    academicYear: student.academicYear,
    stream: student.stream,
    rollNumber: student.rollNumber,
    ...(student.enrollmentEffectiveFrom ? { effectiveFrom: student.enrollmentEffectiveFrom } : {}),
    promotedDate: endDate,
  };
}

async function getDraft(id, actor) {
  actorId(actor);
  if (!mongoose.isValidObjectId(id)) throw new ErrorResponse('Rollover execution not found', 404);
  const rollover = await RolloverExecution.findById(id);
  if (!rollover) throw new ErrorResponse('Rollover execution not found', 404);
  return rollover;
}

exports.listActions = () => Array.from(ACTIONS);

exports.createDraft = async ({ sourceAcademicYear, destinationAcademicYear, actor }) => {
  const createdBy = actorId(actor);
  const { source } = await requireYears(sourceAcademicYear, destinationAcademicYear);
  const students = await Student.find({ academicYear: source.name }).select(
    '_id class academicYear isActive tcIssued enrollmentHistory enrollmentEffectiveFrom'
  ).sort({ class: 1, rollNumber: 1 });
  try {
    return await RolloverExecution.create({
      sourceAcademicYear: source.name,
      destinationAcademicYear,
      createdBy,
      decisions: students.map(student => ({
        student: student._id,
        action: 'pending',
        currentClass: student.class,
        currentAcademicYear: student.academicYear,
        currentIsActive: student.isActive !== false,
        currentTcIssued: student.tcIssued === true,
      })),
    });
  } catch (error) {
    if (error && error.code === 11000) {
      throw new ErrorResponse('A rollover already exists for these academic years', 409);
    }
    throw error;
  }
};

exports.getDraft = getDraft;

exports.listDrafts = async (actor) => {
  actorId(actor);
  return RolloverExecution.find({ status: { $in: ['draft', 'executing'] } }).sort({ updatedAt: -1 });
};

exports.saveDecisions = async (id, body, actor) => {
  actorId(actor);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ErrorResponse('Request body must be an object', 400);
  }
  if (!Array.isArray(body.decisions)) {
    throw new ErrorResponse('decisions must be an array', 400);
  }
  if (body.expectedRevision === undefined || body.expectedRevision === null ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
    throw new ErrorResponse('A valid expectedRevision is required to save rollover decisions', 400);
  }
  const rollover = await getDraft(id, actor);
  if (rollover.status !== 'draft') throw new ErrorResponse('Only draft rollovers can be edited', 409);
  if (body.expectedRevision !== rollover.revision) {
    throw new ErrorResponse('This rollover draft changed since it was loaded; reload before saving', 409);
  }
  const { source, destination } = await requireYears(
    rollover.sourceAcademicYear, rollover.destinationAcademicYear
  );
  const existing = new Map(rollover.decisions.map(decision => [String(decision.student), decision]));
  const updates = new Map();
  for (const decision of body.decisions) {
    if (!mongoose.isValidObjectId(decision.student)) {
      throw new ErrorResponse('Each decision must reference a valid student', 400);
    }
    if (!existing.has(String(decision.student))) {
      throw new ErrorResponse('Decision references a student outside this rollover', 400);
    }
    const normalized = validateDecision(decision, source, destination);
    updates.set(String(decision.student), normalized);
  }
  if (updates.size !== body.decisions.length) {
    throw new ErrorResponse('Each student may have only one rollover decision', 400);
  }
  const updatedDecisions = rollover.decisions.map(existingDecision => {
    const studentId = String(existingDecision.student);
    const update = updates.get(studentId);
    if (!update) return existingDecision.toObject ? existingDecision.toObject() : existingDecision;
    const matchingInput = body.decisions.find(item => String(item.student) === studentId);
    return {
      student: existingDecision.student,
      action: update.action,
      currentClass: existingDecision.currentClass,
      currentAcademicYear: existingDecision.currentAcademicYear,
      currentIsActive: existingDecision.currentIsActive,
      currentTcIssued: existingDecision.currentTcIssued,
      effectiveDate: update.effectiveDate,
      note: matchingInput ? matchingInput.note : existingDecision.note,
      result: 'pending',
      error: undefined,
    };
  });

  const updated = await RolloverExecution.findOneAndUpdate(
    {
      _id: id,
      status: 'draft',
      revision: body.expectedRevision,
    },
    {
      $set: { decisions: updatedDecisions },
      $inc: { revision: 1 },
    },
    {
      new: true,
      runValidators: true,
    }
  );
  if (!updated) {
    throw new ErrorResponse('This rollover draft was modified or executed concurrently; reload before saving', 409);
  }
  return updated;
};

async function executeDecision(decision, source, destination, session) {
  const studentQuery = Student.findOne({
    _id: decision.student,
    academicYear: source.name,
    class: decision.currentClass,
    isActive: decision.currentIsActive ? { $ne: false } : false,
    tcIssued: decision.currentTcIssued ? true : { $ne: true },
  });
  studentQuery.session(session);
  const student = await studentQuery;
  if (!student) throw new ErrorResponse('Student changed since the rollover decision was saved', 409);

  if (decision.action === 'leave_unchanged') {
    return student;
  }

  const normalizedClass = Class.validateAndNormalizeClassWrite(student.class, 'student class');
  const destinationStart = schoolDayBounds(schoolDateKey(destination.startDate)).start;
  if (decision.action === 'promote' || decision.action === 'continue') {
    if (decision.action === 'promote' && !PROMOTION_CLASS_MAP[normalizedClass]) {
      throw new ErrorResponse('Class 12 and non-promotable classes cannot be promoted', 400);
    }
    if (!Array.isArray(student.enrollmentHistory)) student.enrollmentHistory = [];
    student.enrollmentHistory.push(historyEntry(student, destinationStart));
    student.class = decision.action === 'promote' ? PROMOTION_CLASS_MAP[normalizedClass] : normalizedClass;
    student.academicYear = destination.name;
    student.enrollmentEffectiveFrom = destinationStart;
    student.academicStatus = 'enrolled';
  } else {
    const effectiveDate = schoolDayBounds(normalizeEffectiveDate(decision.effectiveDate, 'decision effective date')).start;
    const effectiveDateKey = schoolDateKey(effectiveDate);
    if (!isWithinAcademicYear(effectiveDateKey, source)) {
      throw new ErrorResponse('Decision effective date must fall within the source academic year', 400);
    }
    if (student.enrollmentEffectiveFrom && effectiveDateKey < schoolDateKey(student.enrollmentEffectiveFrom)) {
      throw new ErrorResponse('Decision effective date cannot precede the student current enrollment date', 400);
    }
    const exclusiveHistoryBoundary = schoolDayBounds(nextSchoolDate(effectiveDateKey)).start;
    if (!Array.isArray(student.enrollmentHistory)) student.enrollmentHistory = [];
    student.enrollmentHistory.push(historyEntry(student, exclusiveHistoryBoundary));
    student.isActive = false;
    student.academicStatus = decision.action === 'graduate' ? 'graduated' :
      decision.action === 'withdraw' ? 'withdrawn' : 'transferred';
    if (decision.action === 'transfer') {
      student.tcIssued = true;
      student.tcDate = new Date();
      student.tcLastEnrolledDate = effectiveDate;
    }
    if (student.user) {
      await User.updateOne({ _id: student.user }, { $set: { isActive: false } }).session(session);
    }
  }
  return student.save({ session });
}

exports.execute = async (id, actor, auditContext = {}) => {
  const executedBy = actorId(actor);
  const rollover = await getDraft(id, actor);
  if (rollover.status === 'completed') throw new ErrorResponse('This rollover has already been completed', 409);
  if (rollover.status !== 'draft') throw new ErrorResponse('This rollover is not available for execution', 409);
  if (rollover.decisions.some(decision => decision.action === 'pending')) {
    throw new ErrorResponse('Every student must have an explicit decision before execution', 409);
  }

  let session;
  try {
    session = await mongoose.startSession();
    return await session.withTransaction(async () => {
      const current = await RolloverExecution.findOneAndUpdate(
        { _id: id, status: 'draft' },
        { $set: { status: 'executing', executedBy } },
        { new: true, session }
      );
      if (!current) throw new ErrorResponse('This rollover was already executed or is being executed', 409);
      const { source, destination } = await requireYears(
        current.sourceAcademicYear, current.destinationAcademicYear, session
      );
      for (const decision of current.decisions) {
        await executeDecision(decision, source, destination, session);
        decision.result = 'applied';
      }
      source.isCurrent = false;
      destination.isCurrent = true;
      await source.save({ session });
      await destination.save({ session });
      await AuditLog.create([{
        user: executedBy,
        action: 'academic_year_rollover',
        resource: 'RolloverExecution',
        resourceId: current._id,
        details: {
          sourceAcademicYear: current.sourceAcademicYear,
          destinationAcademicYear: current.destinationAcademicYear,
          decisions: current.decisions.map(decision => ({
            student: decision.student, action: decision.action, result: decision.result,
          })),
        },
        ipAddress: auditContext.ipAddress || null,
        userAgent: auditContext.userAgent || null,
      }], { session });
      current.status = 'completed';
      current.executedAt = new Date();
      return current.save({ session });
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      throw new ErrorResponse('Rollover requires MongoDB transaction support. No students or academic years were changed.', 503);
    }
    if (error && error.isOperational) throw error;
    throw new ErrorResponse('Rollover failed. No students or academic years were changed.', 500);
  } finally {
    if (session) await session.endSession();
  }
};

exports.ACTIONS = ACTIONS;
