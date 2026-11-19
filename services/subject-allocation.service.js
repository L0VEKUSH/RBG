'use strict';

const mongoose = require('mongoose');
const SubjectAllocation = require('../models/SubjectAllocation');
const Faculty = require('../models/Faculty');
const Subject = require('../models/Subject');
const AcademicYear = require('../models/AcademicYear');
const Class = require('../models/Class');
const ErrorResponse = require('../utils/errorResponse');
const { isValidAcademicYear } = require('../utils/academic-year');

function assertValidId(id, label) {
  if (!mongoose.isValidObjectId(id)) {
    throw new ErrorResponse(`${label} not found`, 404);
  }
}

function assertCanonicalClass(classLevel) {
  try {
    return Class.validateAndNormalizeClassWrite(classLevel, 'class');
  } catch (error) {
    throw new ErrorResponse(error.message, 400);
  }
}

async function validateReferences(data) {
  if (data.teacher) {
    assertValidId(data.teacher, 'Teacher');
    const faculty = await Faculty.findById(data.teacher).select('_id').lean();
    if (!faculty) throw new ErrorResponse('Referenced teacher does not exist', 400);
  }

  if (data.subject) {
    assertValidId(data.subject, 'Subject');
    const subject = await Subject.findById(data.subject).select('_id classLevels').lean();
    if (!subject) throw new ErrorResponse('Referenced subject does not exist', 400);
    if (data.class && subject.classLevels && subject.classLevels.length > 0) {
      const normalizedClass = assertCanonicalClass(data.class);
      if (!subject.classLevels.includes(normalizedClass)) {
        throw new ErrorResponse(
          `Subject is not offered for class ${normalizedClass}. Offered levels: ${subject.classLevels.join(', ')}`,
          400
        );
      }
    }
  }

  if (data.class) {
    assertCanonicalClass(data.class);
  }

  if (data.academicYear) {
    if (!isValidAcademicYear(data.academicYear)) {
      throw new ErrorResponse('Academic year must use consecutive YYYY-YYYY format', 400);
    }
    const year = await AcademicYear.findOne({ name: data.academicYear }).select('_id').lean();
    if (!year) throw new ErrorResponse(`Academic year '${data.academicYear}' does not exist`, 400);
  }
}

function mapDuplicateError(error) {
  if (error && error.code === 11000) {
    return new ErrorResponse(
      'A subject allocation with this teacher, subject, class, and academic year already exists',
      409
    );
  }
  return error;
}

exports.listAllocations = async (filters = {}) => {
  const query = {};
  if (filters.teacher) query.teacher = filters.teacher;
  if (filters.subject) query.subject = filters.subject;
  if (filters.class) query.class = filters.class;
  if (filters.academicYear) query.academicYear = filters.academicYear;

  return SubjectAllocation.find(query)
    .populate('teacher', 'employeeId user')
    .populate('subject', 'name code type')
    .sort({ academicYear: 1, class: 1 });
};

exports.createAllocation = async (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErrorResponse('A valid subject allocation request object is required', 400);
  }
  if (!data.teacher || !data.subject || !data.class || !data.academicYear) {
    throw new ErrorResponse('teacher, subject, class, and academicYear are required', 400);
  }

  await validateReferences(data);

  try {
    const allocation = await SubjectAllocation.create({
      teacher: data.teacher,
      subject: data.subject,
      class: data.class,
      academicYear: data.academicYear,
    });
    return allocation;
  } catch (error) {
    throw mapDuplicateError(error);
  }
};

exports.getAllocationById = async (id) => {
  assertValidId(id, 'Subject allocation');
  const allocation = await SubjectAllocation.findById(id)
    .populate('teacher', 'employeeId user')
    .populate('subject', 'name code type');
  if (!allocation) throw new ErrorResponse('Subject allocation not found', 404);
  return allocation;
};

exports.updateAllocation = async (id, data) => {
  assertValidId(id, 'Subject allocation');
  const allocation = await SubjectAllocation.findById(id);
  if (!allocation) throw new ErrorResponse('Subject allocation not found', 404);

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErrorResponse('A valid subject allocation update object is required', 400);
  }

  const allowedFields = ['teacher', 'subject', 'class', 'academicYear'];
  const updateData = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      updateData[field] = data[field];
    }
  }

  if (!Object.keys(updateData).length) {
    throw new ErrorResponse('At least one field (teacher, subject, class, or academicYear) is required', 400);
  }

  await validateReferences({ ...allocation.toObject(), ...updateData });

  Object.assign(allocation, updateData);
  try {
    await allocation.save();
  } catch (error) {
    throw mapDuplicateError(error);
  }
  return allocation;
};

exports.deleteAllocation = async (id) => {
  assertValidId(id, 'Subject allocation');
  const allocation = await SubjectAllocation.findByIdAndDelete(id);
  if (!allocation) throw new ErrorResponse('Subject allocation not found', 404);
  return allocation;
};
