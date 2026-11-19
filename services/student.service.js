const User = require('../models/User');
const Student = require('../models/Student');
const Class = require('../models/Class');
const ErrorResponse = require('../utils/errorResponse');
const APIFeatures = require('../utils/apiFeatures');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const AcademicYear = require('../models/AcademicYear');
const AuditLog = require('../models/AuditLog');
const {
  parseSchoolDate, schoolDateKey, schoolDayBounds, isWithinAcademicYear, nextSchoolDate,
} = require('../utils/attendance-date');
const { resolveEffectiveDate, parseEffectiveDate } = require('./enrollment-date.service');
const { getStudentAccess, BASIC_STUDENT_FIELDS, FULL_STUDENT_ACCESS_ROLES } = require('./student-access.service');

/**
 * Returns true when a MongoDB error indicates the topology does not support
 * multi-document transactions (standalone server, pre-4.0, etc.).
 * Mirrors the pattern used in fee.service.js and attendance.service.js.
 */
function isTransactionUnsupported(error) {
  return error && (
    error.code === 20 ||
    error.codeName === 'IllegalOperation' ||
    /transaction numbers are only allowed|transactions are not supported|does not support transactions|replica set/i.test(error.message || '')
  );
}

const CREATE_USER_FIELDS = new Set([
  'name', 'email', 'password', 'gender', 'dateOfBirth', 'phone', 'address',
]);
const CREATE_STUDENT_FIELDS = new Set([
  'rollNumber', 'class', 'academicYear', 'enrollmentEffectiveFrom', 'stream', 'house', 'admissionDate',
  'father', 'mother', 'guardian', 'previousSchool', 'bloodGroup',
  'medicalConditions', 'categoryReservation', 'religion', 'nationality',
]);
const UPDATE_USER_FIELDS = new Set([
  'name', 'email', 'phone', 'address', 'gender', 'dateOfBirth', 'profilePhoto',
]);
const UPDATE_STUDENT_FIELDS = new Set([
  'rollNumber', 'stream', 'house', 'admissionDate',
  'father', 'mother', 'guardian', 'previousSchool', 'bloodGroup',
  'medicalConditions', 'categoryReservation', 'religion', 'nationality',
]);
const NESTED_FIELDS = Object.freeze({
  address: new Set(['street', 'city', 'state', 'pincode']),
  father: new Set(['name', 'occupation', 'phone', 'email']),
  mother: new Set(['name', 'occupation', 'phone', 'email']),
  guardian: new Set(['name', 'relation', 'phone', 'email']),
  previousSchool: new Set(['name', 'address', 'tcNumber']),
});
const LEGACY_FINANCIAL_FIELDS = new Set([
  'fees', 'totalFees', 'paidFees', 'paidAmount', 'discount', 'dueFees',
  'feeStructure', 'payments', 'payment', 'receipt', 'receiptNumber',
  'receivedBy', 'collectedBy', 'collector', 'scholarship', 'fine', 'balanceDue',
]);

function validateInputObject(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErrorResponse('A valid student request object is required', 400);
  }
}

function rejectLegacyFinancialFields(data) {
  const field = Object.keys(data).find((key) =>
    LEGACY_FINANCIAL_FIELDS.has(key) || key.startsWith('fees.')
  );
  if (field) {
    throw new ErrorResponse(
      'Financial fields cannot be set through student endpoints; use the fee ledger workflow',
      400
    );
  }
}

function pickAllowedFields(data, allowedFields, { rejectUnknown = true } = {}) {
  const result = {};
  for (const [field, value] of Object.entries(data)) {
    if (!allowedFields.has(field)) {
      if (rejectUnknown) throw new ErrorResponse(`Unsupported student field: ${field}`, 400);
      continue;
    }
    const nestedAllowed = NESTED_FIELDS[field];
    if ((field === 'father' || field === 'mother') && value == null) {
      throw new ErrorResponse(`${field} cannot be null`, 400);
    }
    if (!nestedAllowed || value == null) {
      result[field] = value;
      continue;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new ErrorResponse(`${field} must be an object`, 400);
    }
    const nestedValue = pickAllowedFields(value, nestedAllowed);
    if ((field === 'father' || field === 'mother') && !Object.keys(nestedValue).length) {
      throw new ErrorResponse(`${field}.name is required`, 400);
    }
    result[field] = nestedValue;
  }
  return result;
}

function hasValidFamilyName(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateRequiredFamilyNames(studentData) {
  for (const field of ['father', 'mother']) {
    if (!studentData[field] || !hasValidFamilyName(studentData[field].name)) {
      throw new ErrorResponse(`${field}.name is required`, 400);
    }
  }
}

function validateFamilyUpdate(studentData, currentStudent) {
  for (const field of ['father', 'mother']) {
    if (!Object.prototype.hasOwnProperty.call(studentData, field)) continue;
    const nextName = Object.prototype.hasOwnProperty.call(studentData[field], 'name')
      ? studentData[field].name
      : currentStudent[field] && currentStudent[field].name;
    if (!hasValidFamilyName(nextName)) {
      throw new ErrorResponse(`${field}.name is required`, 400);
    }
  }
}

function prepareStudentInput(data, userFields, studentFields) {
  validateInputObject(data);
  rejectLegacyFinancialFields(data);
  if (data.section !== undefined || data.sections !== undefined) {
    throw new ErrorResponse('Class sections are not supported. RBG School ERP models single undivided classes per level.', 400);
  }
  const allowed = new Set([...userFields, ...studentFields]);
  const userInput = {};
  const studentInput = {};
  for (const field of Object.keys(data)) {
    if (!allowed.has(field)) throw new ErrorResponse(`Unsupported student field: ${field}`, 400);
    if (userFields.has(field)) userInput[field] = data[field];
    else studentInput[field] = data[field];
  }
  if (!Object.keys(data).length) throw new ErrorResponse('At least one student field is required', 400);
  const userData = pickAllowedFields(userInput, userFields);
  const studentData = pickAllowedFields(studentInput, studentFields);
  if (studentData.class !== undefined) {
    try {
      studentData.class = Class.validateAndNormalizeClassWrite(studentData.class, 'class');
    } catch (err) {
      throw new ErrorResponse(err.message, 400);
    }
  }
  return { userData, studentData };
}

class StudentService {
  /**
   * Create student with linked User account
   */
  async createStudent(data, createdBy) {
    const { userData, studentData } = prepareStudentInput(
      data, CREATE_USER_FIELDS, CREATE_STUDENT_FIELDS
    );
    validateRequiredFamilyNames(studentData);
    if (!Object.prototype.hasOwnProperty.call(studentData, 'enrollmentEffectiveFrom')) {
      throw new ErrorResponse('An explicit YYYY-MM-DD enrollment effective date is required.', 400);
    }
    const enrollment = await resolveEffectiveDate(
      studentData.enrollmentEffectiveFrom, studentData.academicYear
    );
    studentData.enrollmentEffectiveFrom = enrollment.effectiveFrom;
    const { name, email, password } = userData;

    // Check email uniqueness
    const existingUser = await User.findOne({ email });
    if (existingUser) throw new ErrorResponse('Email already in use', 400);

    // Create user
    const user = await User.create({ ...userData, role: 'student' });

    // Create student profile
    const student = await Student.create({ user: user._id, ...studentData });
    logger.info(`Student created: ${user.name} [${student.admissionNumber}] by ${createdBy}`);
    return student;
  }

  /**
   * Get all students with filters, sorting, pagination
   */
  async getAllStudents(queryString, user) {
    const access = await getStudentAccess(user);
    const scopedFilter = { ...access.filter, isActive: true };
    const safeQuery = { ...queryString };
    if (access.basic) delete safeQuery.fields;
    let baseQuery = Student.find(scopedFilter);
    if (access.basic) {
      baseQuery = baseQuery.select(BASIC_STUDENT_FIELDS).populate('user', 'name');
    } else {
      baseQuery = baseQuery.populate('user', 'name email phone profilePhoto gender dateOfBirth address');
    }

    const features = new APIFeatures(baseQuery, safeQuery)
      .search(['admissionNumber', 'rollNumber', 'class', 'stream'])
      .filter()
      .sort()
      .limitFields()
      .paginate();

    const students = await features.query;
    const total = await Student.countDocuments(scopedFilter);

    return {
      students,
      total,
      page: features.page,
      limit: features.limit,
      pages: Math.ceil(total / features.limit),
    };
  }

  /**
   * Get single student by ID
   */
  async getStudentById(id, user) {
    if (!mongoose.isValidObjectId(id)) throw new ErrorResponse('Student not found', 404);
    const access = await getStudentAccess(user);
    const isAuthorizedAdmin = Boolean(user && FULL_STUDENT_ACCESS_ROLES.has(user.role));
    const statusFilter = isAuthorizedAdmin ? {} : { isActive: true };
    let query = Student.findOne({ $and: [access.filter, { _id: id }, statusFilter] });
    if (access.basic) {
      query = query.select(BASIC_STUDENT_FIELDS).populate('user', 'name');
    } else {
      query = query.populate('user', '-password -resetPasswordToken -resetPasswordExpire -activationToken -activationTokenExpire');
    }
    const student = await query;
    if (!student) throw new ErrorResponse(`Student not found with id: ${id}`, 404);
    return student;
  }

  /**
   * Get student by admission number
   */
  async getStudentByAdmissionNumber(admNo) {
    const student = await Student.findOne({ admissionNumber: admNo.toUpperCase() })
      .populate('user', '-password');
    if (!student) throw new ErrorResponse(`Student not found: ${admNo}`, 404);
    return student;
  }

  /**
   * Update student profile
   */
  async updateStudent(id, data) {
    const { userData, studentData } = prepareStudentInput(
      data, UPDATE_USER_FIELDS, UPDATE_STUDENT_FIELDS
    );
    const student = await Student.findById(id);
    if (!student) throw new ErrorResponse(`Student not found with id: ${id}`, 404);
    validateFamilyUpdate(studentData, student);

    // Update user info
    if (Object.keys(userData).length) {
      await User.findByIdAndUpdate(student.user, { $set: userData }, { runValidators: true });
    }

    // Update student info
    const updatedStudent = await Student.findByIdAndUpdate(id, { $set: studentData }, {
      new: true,
      runValidators: true,
    }).populate('user', '-password');

    logger.info(`Student updated: ${id}`);
    return updatedStudent;
  }

  /**
   * Delete (soft delete) student
   */
  async deleteStudent(id) {
    const student = await Student.findById(id);
    if (!student) throw new ErrorResponse(`Student not found with id: ${id}`, 404);

    student.isActive = false;
    await student.save();
    await User.findByIdAndUpdate(student.user, { isActive: false });
    logger.info(`Student deactivated: ${id}`);
    return student;
  }

  /**
   * Get students by class 
   */
  async getStudentsByClass(cls, academicYear, user, options = {}) {
    const access = await getStudentAccess(user);
    const isAuthorizedAdmin = Boolean(user && FULL_STUDENT_ACCESS_ROLES.has(user.role));
    // Only admins may request inactive/TC-issued students; restricted roles always see active only
    const includeInactive = isAuthorizedAdmin && options.includeInactive === true;
    const query = { ...access.filter, class: cls };
    if (!includeInactive) query.isActive = true;
    if (academicYear) query.academicYear = academicYear;

    let studentsQuery = Student.find(query);
    if (access.basic || ['teacher', 'class_teacher', 'faculty'].includes(user.role)) {
      studentsQuery = studentsQuery
        .select('_id admissionNumber class rollNumber academicYear user tcIssued isActive')
        .populate('user', 'name');
    }
    else studentsQuery = studentsQuery.populate('user', 'name email phone profilePhoto gender');
    return studentsQuery
      .sort('rollNumber');
  }

  /**
   * Promote students to next class (atomic batch).
   *
   * Request contract:
   *   studentIds      – non-empty array of valid ObjectId strings, no duplicates
   *   newAcademicYear – consecutive target year (YYYY-YYYY, startYear = sourceStartYear + 1)
   *   sourceAcademicYear – the academic year students must currently belong to
   *   sourceClass     – the class students must currently belong to
   *
   * Rules enforced independently of frontend state:
   *   - Every ID is a valid MongoDB ObjectId.
   *   - No duplicate IDs.
   *   - Every student exists and is active.
   *   - Every student's current class is canonical and matches sourceClass.
   *   - Every student's current academicYear matches sourceAcademicYear.
   *   - sourceClass must be canonical and have a permitted next class (Class 12 is terminal and excluded).
   *   - Target year is exactly source year + 1.
   *   - Target AcademicYear document exists in the database.
   *   - Effective date auto-derived from target year startDate (same-year transfers not supported).
   *   - Target class is computed from the canonical promotion map; an optional newClass must match it.
   *   - The entire batch is written inside one MongoDB transaction; any failure aborts all writes.
   *   - Requires replica-set topology; fails with 503 if transactions are unavailable.
   */
  async promoteStudents(studentIds, newClass, newAcademicYear, {
    sourceAcademicYear, sourceClass, actor, auditContext = {},
  } = {}) {
    // Class 12 is intentionally absent: it is terminal and cannot be promoted.
    const PROMOTION_CLASS_MAP = Object.freeze({
      'Nursery': 'LKG',
      'LKG': 'UKG',
      'UKG': '1',
      '1': '2', '2': '3', '3': '4', '4': '5', '5': '6',
      '6': '7', '7': '8', '8': '9', '9': '10', '10': '11','11': '12',
    });

    const parseAcademicYear = (value, label) => {
      const match = typeof value === 'string' && /^(\d{4})-(\d{4})$/.exec(value);
      const startYear = match ? Number(match[1]) : 0;
      const endYear = match ? Number(match[2]) : 0;
      if (!match || startYear < 1 || endYear !== startYear + 1) {
        throw new ErrorResponse(label + ' must be a consecutive YYYY-YYYY academic year', 400);
      }
      return startYear;
    };

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      throw new ErrorResponse('studentIds must be a non-empty array', 400);
    }
    const sourceStart = parseAcademicYear(sourceAcademicYear, 'sourceAcademicYear');
    const targetStart = parseAcademicYear(newAcademicYear, 'newAcademicYear');
    if (targetStart !== sourceStart + 1) {
      throw new ErrorResponse(
        'Target academic year (' + newAcademicYear + ') must be exactly one year after source (' + sourceAcademicYear + ')', 400
      );
    }
    if (typeof sourceClass !== 'string' || !sourceClass.trim()) {
      throw new ErrorResponse('sourceClass is required', 400);
    }

    let normalizedSourceClass;
    try {
      normalizedSourceClass = Class.validateAndNormalizeClassWrite(sourceClass, 'sourceClass');
    } catch (err) {
      throw new ErrorResponse(err.message, 400);
    }
    if (!Object.prototype.hasOwnProperty.call(PROMOTION_CLASS_MAP, normalizedSourceClass)) {
      throw new ErrorResponse('Class ' + normalizedSourceClass + ' cannot be automatically promoted.', 400);
    }

    for (const id of studentIds) {
      if (typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id)) {
        throw new ErrorResponse('Every student ID must be a valid MongoDB ObjectId', 400);
      }
    }
    const uniqueIds = new Set(studentIds.map(id => id.toLowerCase()));
    if (uniqueIds.size !== studentIds.length) {
      throw new ErrorResponse('studentIds contains duplicate entries', 400);
    }

    const actorId = actor && (actor._id || actor.id);
    if (!actorId || !mongoose.isValidObjectId(actorId)) {
      throw new ErrorResponse('An authenticated administrator is required to promote students', 401);
    }

    const targetClass = PROMOTION_CLASS_MAP[normalizedSourceClass];
    if (newClass !== undefined && newClass !== null && String(newClass).trim() !== '') {
      let requestedClass;
      try {
        requestedClass = Class.validateAndNormalizeClassWrite(newClass, 'newClass');
      } catch (err) {
        throw new ErrorResponse(err.message, 400);
      }
      if (requestedClass !== targetClass) {
        throw new ErrorResponse('newClass must be the canonical next class for the selected source class', 400);
      }
    }

    let session;
    try {
      session = await mongoose.startSession();
      const promoted = await session.withTransaction(async () => {
        const targetYear = await AcademicYear.findOne({ name: newAcademicYear })
          .session(session)
          .select('name startDate endDate isActive');
        if (!targetYear) {
          throw new ErrorResponse("Target academic year '" + newAcademicYear + "' not found", 404);
        }

        let effectiveDateKey;
        try {
          effectiveDateKey = schoolDateKey(targetYear.startDate);
        } catch (_) {
          throw new ErrorResponse('Target academic year has invalid date boundaries', 400);
        }

        const activeYears = await AcademicYear.find({ isActive: true })
          .session(session)
          .select('name startDate endDate');
        let matchingYears;
        try {
          matchingYears = activeYears.filter(year => isWithinAcademicYear(effectiveDateKey, year));
        } catch (_) {
          throw new ErrorResponse('Academic year has invalid date boundaries', 409);
        }
        if (matchingYears.length > 1) {
          throw new ErrorResponse('Promotion effective date matches overlapping academic years', 409);
        }
        if (matchingYears.length === 0 || matchingYears[0].name !== newAcademicYear) {
          throw new ErrorResponse('Promotion effective date must fall within the selected active academic year', 409);
        }

        const effectiveFrom = schoolDayBounds(effectiveDateKey).start;
        const students = await Student.find({
          _id: { $in: Array.from(uniqueIds) },
          isActive: { $ne: false },
        }).session(session)
          .select('_id class academicYear enrollmentHistory enrollmentEffectiveFrom stream rollNumber');

        if (students.length !== uniqueIds.size) {
          const foundIds = new Set(students.map(student => String(student._id).toLowerCase()));
          const missing = Array.from(uniqueIds).filter(id => !foundIds.has(id));
          throw new ErrorResponse('Student(s) not found or inactive: ' + missing.join(', '), 404);
        }

        // Validate every member of the batch before the first write.
        for (const student of students) {
          let currentClass;
          try {
            currentClass = Class.validateAndNormalizeClassWrite(student.class, 'student current class');
          } catch (_) {
            throw new ErrorResponse('Student ' + student._id + ' has an invalid current class', 400);
          }
          if (currentClass !== normalizedSourceClass) {
            throw new ErrorResponse(
              "Student " + student._id + " belongs to class '" + student.class + "', not '" + normalizedSourceClass + "'", 400
            );
          }
          if (String(student.academicYear) !== sourceAcademicYear) {
            throw new ErrorResponse(
              "Student " + student._id + " belongs to academic year '" + student.academicYear + "', not '" + sourceAcademicYear + "'", 400
            );
          }
          if (!Object.prototype.hasOwnProperty.call(PROMOTION_CLASS_MAP, currentClass)) {
            throw new ErrorResponse('Student ' + student._id + ' cannot be automatically promoted from class ' + currentClass, 400);
          }
        }

        const results = [];
        for (const student of students) {
          if (!Array.isArray(student.enrollmentHistory)) student.enrollmentHistory = [];
          student.enrollmentHistory.push({
            class: normalizedSourceClass,
            academicYear: student.academicYear,
            stream: student.stream,
            rollNumber: student.rollNumber,
            ...(student.enrollmentEffectiveFrom ? { effectiveFrom: student.enrollmentEffectiveFrom } : {}),
            promotedDate: effectiveFrom,
          });
          student.class = targetClass;
          student.academicYear = newAcademicYear;
          student.enrollmentEffectiveFrom = effectiveFrom;
          results.push(await student.save({ session }));
        }

        await AuditLog.create([{
          user: actorId,
          action: 'bulk_promotion',
          resource: 'Student',
          details: {
            studentIds: results.map(student => String(student._id)),
            promotedCount: results.length,
            sourceClass: normalizedSourceClass,
            sourceAcademicYear,
            targetClass,
            targetAcademicYear: newAcademicYear,
          },
          ipAddress: auditContext.ipAddress || null,
          userAgent: auditContext.userAgent || null,
        }], { session });

        return results;
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      });

      logger.info(
        'Bulk promotion: ' + promoted.length + ' students promoted from ' + normalizedSourceClass +
        ' (' + sourceAcademicYear + ') to ' + targetClass + ' (' + newAcademicYear + ')'
      );
      return promoted;
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        throw new ErrorResponse(
          'Bulk promotion requires MongoDB transaction support (replica set). No students were promoted.',
          503
        );
      }
      if (error && error.isOperational) throw error;
      logger.error('Bulk student promotion failed; transaction was aborted.');
      throw new ErrorResponse('Promotion failed. No students were promoted.', 500);
    } finally {
      if (session) {
        try { await session.endSession(); } catch (_) { /* ignore */ }
      }
    }
  }

  /**
   * Issue Transfer Certificate (TC)
   */
  async issueTC(id, tcDetails) {
    if (!tcDetails || typeof tcDetails !== 'object' || Array.isArray(tcDetails)) {
      throw new ErrorResponse('A last-enrolled date is required to issue a TC.', 400);
    }
    const unsupported = Object.keys(tcDetails).find(field => !['lastEnrolledDate', 'remarks'].includes(field));
    if (unsupported) throw new ErrorResponse(`Unsupported TC field: ${unsupported}`, 400);
    const lastEnrolled = parseEffectiveDate(tcDetails.lastEnrolledDate, 'last-enrolled date');
    if (tcDetails.remarks !== undefined &&
        (typeof tcDetails.remarks !== 'string' || tcDetails.remarks.length > 1000)) {
      throw new ErrorResponse('TC remarks must be text no longer than 1000 characters.', 400);
    }
    const student = await Student.findById(id);
    if (!student) throw new ErrorResponse(`Student not found with id: ${id}`, 404);

    if (student.tcIssued) throw new ErrorResponse(`TC already issued for this student`, 400);

    const currentEnrollmentStart = student.enrollmentEffectiveFrom
      ? schoolDateKey(student.enrollmentEffectiveFrom)
      : null;
    if (currentEnrollmentStart && lastEnrolled.dateKey < currentEnrollmentStart) {
      throw new ErrorResponse('Last-enrolled date cannot be before the current enrollment began.', 400);
    }

    let lastEnrolledExclusiveBoundary;
    try {
      lastEnrolledExclusiveBoundary = schoolDayBounds(nextSchoolDate(lastEnrolled.dateKey)).start;
    } catch (error) {
      throw new ErrorResponse(error.message, 400);
    }

    if (!Array.isArray(student.enrollmentHistory)) student.enrollmentHistory = [];
    const historyEntry = {
      class: student.class,
      academicYear: student.academicYear,
      stream: student.stream,
      rollNumber: student.rollNumber,
      ...(student.enrollmentEffectiveFrom ? { effectiveFrom: student.enrollmentEffectiveFrom } : {}),
      promotedDate: lastEnrolledExclusiveBoundary,
    };
    const issueDate = new Date();
    const currentEnrollmentFilter = {
      _id: id,
      tcIssued: { $ne: true },
      class: student.class,
      academicYear: student.academicYear,
      enrollmentEffectiveFrom: student.enrollmentEffectiveFrom || null,
    };
    const updatedStudent = await Student.findOneAndUpdate(currentEnrollmentFilter, {
      $set: {
        tcIssued: true,
        tcDate: issueDate,
        tcLastEnrolledDate: lastEnrolled.effectiveFrom,
        remarks: tcDetails.remarks || 'TC Issued',
        isActive: false,
      },
      $push: { enrollmentHistory: historyEntry },
    }, { new: true, runValidators: true });
    if (!updatedStudent) {
      throw new ErrorResponse('Student enrollment or TC status changed concurrently; reload and retry.', 409);
    }
    
    await User.findByIdAndUpdate(updatedStudent.user, { isActive: false });
    
    logger.info(`TC issued for student: ${id}`);
    return updatedStudent;
  }

  /**
   * Retired duplicate fee-ledger write path. Kept as a fail-closed compatibility
   * response for any direct service callers while the route is transitioned.
   */
  async updateFeePayment() {
    throw new ErrorResponse('Legacy student fee writes are retired; use the fee ledger payment endpoint', 410);
  }

  /**
   * Dashboard stats
   */
  async getDashboardStats() {
    const [total, byClass, byStream, byCategory] = await Promise.all([
      Student.countDocuments({ isActive: true }),
      Student.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$class', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Student.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$stream', count: { $sum: 1 } } },
      ]),
      Student.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$categoryReservation', count: { $sum: 1 } } },
      ]),
    ]);
    return { total, byClass, byStream, byCategory };
  }
}

module.exports = new StudentService();
