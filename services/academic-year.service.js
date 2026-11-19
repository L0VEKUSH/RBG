'use strict';

const mongoose = require('mongoose');
const AcademicYear = require('../models/AcademicYear');
const AuditLog = require('../models/AuditLog');
const ErrorResponse = require('../utils/errorResponse');
const { parseSchoolDate, schoolDayBounds } = require('../utils/attendance-date');
const { isValidAcademicYear } = require('../utils/academic-year');

const EDITABLE_FIELDS = new Set(['name', 'startDate', 'endDate', 'terms']);
const PROTECTED_FIELDS = new Set([
  '_id', 'isActive', 'isCurrent', 'createdAt', 'updatedAt',
]);

function assertValidId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new ErrorResponse('Academic year not found', 404);
  }
}

function normalizeSchoolDate(value, label) {
  if (typeof value !== 'string') {
    throw new ErrorResponse(`A ${label} in YYYY-MM-DD format is required`, 400);
  }
  try {
    const parsed = parseSchoolDate(value, label);
    return schoolDayBounds(parsed.value).start;
  } catch (error) {
    throw new ErrorResponse(error.message, 400);
  }
}

function normalizePayload(data, { partial = false } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErrorResponse('A valid academic year request object is required', 400);
  }

  const protectedField = Object.keys(data).find(field => PROTECTED_FIELDS.has(field));
  if (protectedField) {
    throw new ErrorResponse(`Field '${protectedField}' cannot be changed through this endpoint`, 400);
  }

  const unknownField = Object.keys(data).find(field => !EDITABLE_FIELDS.has(field));
  if (unknownField) {
    throw new ErrorResponse(`Unsupported academic year field: ${unknownField}`, 400);
  }

  if (!partial && (!Object.prototype.hasOwnProperty.call(data, 'name') ||
      !Object.prototype.hasOwnProperty.call(data, 'startDate') ||
      !Object.prototype.hasOwnProperty.call(data, 'endDate'))) {
    throw new ErrorResponse('Name, startDate, and endDate are required', 400);
  }

  const payload = {};
  if (Object.prototype.hasOwnProperty.call(data, 'name')) {
    if (typeof data.name !== 'string' || !isValidAcademicYear(data.name.trim())) {
      throw new ErrorResponse('Academic year name must use consecutive YYYY-YYYY format', 400);
    }
    payload.name = data.name.trim();
  }
  if (Object.prototype.hasOwnProperty.call(data, 'startDate')) {
    payload.startDate = normalizeSchoolDate(data.startDate, 'academic year start date');
  }
  if (Object.prototype.hasOwnProperty.call(data, 'endDate')) {
    payload.endDate = normalizeSchoolDate(data.endDate, 'academic year end date');
  }
  if (Object.prototype.hasOwnProperty.call(data, 'terms')) {
    if (!Array.isArray(data.terms)) {
      throw new ErrorResponse('Academic year terms must be an array', 400);
    }
    payload.terms = data.terms;
  }
  return payload;
}

function mapDuplicateError(error, name) {
  if (error && error.code === 11000) {
    return new ErrorResponse(`Academic year '${name}' already exists`, 409);
  }
  return error;
}

exports.listAcademicYears = async () => AcademicYear.find().sort({ startDate: 1 });

exports.getAcademicYear = async (id) => {
  assertValidId(id);
  const academicYear = await AcademicYear.findById(id);
  if (!academicYear) throw new ErrorResponse('Academic year not found', 404);
  return academicYear;
};

exports.createAcademicYear = async (data) => {
  const payload = normalizePayload(data);
  try {
    return await AcademicYear.create(payload);
  } catch (error) {
    throw mapDuplicateError(error, payload.name);
  }
};

exports.updateAcademicYear = async (id, data) => {
  assertValidId(id);
  const academicYear = await exports.getAcademicYear(id);
  const payload = normalizePayload(data, { partial: true });
  if (!Object.keys(payload).length) {
    throw new ErrorResponse('At least one academic year field is required', 400);
  }

  Object.assign(academicYear, payload);
  try {
    await academicYear.save();
  } catch (error) {
    throw mapDuplicateError(error, payload.name || academicYear.name);
  }
  return academicYear;
};

async function setActiveState(id, isActive) {
  assertValidId(id);
  const academicYear = await exports.getAcademicYear(id);
  if (!isActive && academicYear.isCurrent === true) {
    throw new ErrorResponse('The current academic year cannot be deactivated', 409);
  }
  if (academicYear.isActive === isActive) return academicYear;

  academicYear.isActive = isActive;
  try {
    await academicYear.save();
  } catch (error) {
    throw mapDuplicateError(error, academicYear.name);
  }
  return academicYear;
}

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
    throw new ErrorResponse('An authenticated administrator is required to establish the current academic year', 401);
  }
  return id;
}

exports.establishCurrentAcademicYear = async (id, actor, auditContext = {}) => {
  assertValidId(id);
  const adminId = actorId(actor);

  let session;
  try {
    session = await mongoose.startSession();
    return await session.withTransaction(async () => {
      const candidate = await AcademicYear.findById(id).session(session);
      if (!candidate) {
        throw new ErrorResponse('Academic year not found', 404);
      }
      if (candidate.isActive !== true) {
        throw new ErrorResponse('An inactive academic year cannot be established as current', 400);
      }
      if (candidate.isCurrent === true) {
        throw new ErrorResponse('Academic year is already marked as current', 409);
      }

      const existingCurrent = await AcademicYear.findOne({ isCurrent: true }).session(session);
      if (existingCurrent && existingCurrent._id.toString() !== candidate._id.toString()) {
        throw new ErrorResponse('Another academic year is already established as current; use rollover workflow instead', 409);
      }

      candidate.isCurrent = true;
      await candidate.save({ session });

      await AuditLog.create([{
        user: adminId,
        action: 'academic_year_establish_current',
        resource: 'AcademicYear',
        resourceId: candidate._id,
        details: {
          academicYearId: candidate._id,
          name: candidate.name,
        },
        ipAddress: auditContext.ipAddress || null,
        userAgent: auditContext.userAgent || null,
      }], { session });

      return candidate;
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      throw new ErrorResponse('Establishing the current academic year requires MongoDB transaction support. No academic years were changed.', 503);
    }
    if (error && error.code === 11000) {
      throw new ErrorResponse('Another academic year was concurrently established as current', 409);
    }
    if (error && error.isOperational) throw error;
    throw error;
  } finally {
    if (session) await session.endSession();
  }
};

exports.activateAcademicYear = async (id) => setActiveState(id, true);
exports.deactivateAcademicYear = async (id) => setActiveState(id, false);

exports._normalizePayload = normalizePayload;
