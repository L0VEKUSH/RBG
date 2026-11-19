const studentService = require('../services/student.service');
const ErrorResponse = require('../utils/errorResponse');

/**
 * @desc    Create student
 * @route   POST /api/v1/students
 * @access  Private (Admin)
 */
exports.createStudent = async (req, res, next) => {
  res.status(410).json({
    success: false,
    message: 'Password-based account creation is disabled. Use the Student invitation workflow; the account owner sets their password during activation.',
  });
};

/**
 * @desc    Get all students
 * @route   GET /api/v1/students
 * @access  Private (Admin, Faculty)
 */
exports.getAllStudents = async (req, res) => {
  const result = await studentService.getAllStudents(req.query, req.user);

  res.status(200).json({ success: true, ...result });
};

/**
 * @desc    Get student by ID
 * @route   GET /api/v1/students/:id
 * @access  Private
 */
exports.getStudentById = async (req, res) => {
  const student = await studentService.getStudentById(req.params.id, req.user);
  res.status(200).json({ success: true, data: { student } });
};

/**
 * @desc    Update student
 * @route   PUT /api/v1/students/:id
 * @access  Private (Admin)
 */
exports.updateStudent = async (req, res) => {
  const student = await studentService.updateStudent(req.params.id, req.body);
  res.status(200).json({ success: true, message: 'Student updated successfully', data: { student } });
};

/**
 * @desc    Delete student (soft delete)
 * @route   DELETE /api/v1/students/:id
 * @access  Private (Admin)
 */
exports.deleteStudent = async (req, res) => {
  await studentService.deleteStudent(req.params.id);
  res.status(200).json({ success: true, message: 'Student deactivated successfully' });
};

/**
 * @desc    Get students by class
 * @route   GET /api/v1/students/class/:class
 * @access  Private (Admin, Faculty)
 */
exports.getStudentsByClass = async (req, res) => {
  const { academicYear } = req.query;
  const includeInactive = req.query.includeInactive === 'true';
  const students = await studentService.getStudentsByClass(req.params.class, academicYear, req.user, { includeInactive });
  res.status(200).json({ success: true, count: students.length, data: { students } });
};

/**
 * @desc    Promote students
 * @route   POST /api/v1/students/promote
 * @access  Private (Admin)
 */
exports.promoteStudents = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { studentIds, newClass, newAcademicYear, sourceAcademicYear, sourceClass } = body;
  try {
    const students = await studentService.promoteStudents(studentIds, newClass, newAcademicYear, {
      sourceAcademicYear,
      sourceClass,
      actor: req.user,
      auditContext: {
        ipAddress: req.ip,
        userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      },
    });
    res.status(200).json({
      success: true,
      message: `${students.length} students promoted successfully`,
      data: { students, promotedCount: students.length },
    });
  } catch (error) {
    const isOperational = Boolean(error && error.isOperational);
    res.status(isOperational ? error.statusCode : 500).json({
      success: false,
      message: isOperational ? error.message : 'Promotion failed. No students were promoted.',
    });
  }
};

/**
 * @desc    Issue Transfer Certificate (TC)
 * @route   POST /api/v1/students/:id/tc
 * @access  Private (Admin)
 */
exports.issueTC = async (req, res) => {
  const student = await studentService.issueTC(req.params.id, req.body);
  res.status(200).json({ success: true, message: 'TC issued successfully', data: { student } });
};

/**
 * @desc    Update student fee payment
 * @route   PUT /api/v1/students/:id/fees
 * @access  Private (Admin)
 */
exports.updateFeePayment = async (req, res, next) => {
  return next(new ErrorResponse('Legacy student fee writes are retired; use the fee ledger payment endpoint', 410));
};

/**
 * @desc    Get dashboard stats
 * @route   GET /api/v1/students/stats
 * @access  Private (Admin)
 */
exports.getDashboardStats = async (req, res) => {
  const stats = await studentService.getDashboardStats();
  res.status(200).json({ success: true, data: { stats } });
};

/**
 * @desc    Get own profile (student)
 * @route   GET /api/v1/students/my-profile
 * @access  Private (Student)
 */
exports.getMyProfile = async (req, res) => {
  const Student = require('../models/Student');
  const student = await Student.findOne({ user: req.user.id })
    .populate('user', '-password');
  if (!student) {
    return res.status(404).json({ success: false, message: 'Student profile not found' });
  }
  res.status(200).json({ success: true, data: { student } });
};

/**
 * @desc    Upload student document
 * @route   POST /api/v1/students/:id/documents
 * @access  Private (Staff with students.update)
 */
exports.uploadStudentDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new ErrorResponse('Please select a document to upload', 400));
    }
    const Student = require('../models/Student');
    const student = await Student.findById(req.params.id);
    if (!student) {
      return next(new ErrorResponse('Student not found', 404));
    }
    const uploadService = require('../services/upload.service');
    const saved = await uploadService.saveFile(req.file, 'documents');
    try {
      const docName = (req.body && typeof req.body.name === 'string' && req.body.name.trim())
        ? req.body.name.trim()
        : req.file.originalname || 'Student Document';
      student.documents.push({
        name: docName,
        url: saved.url,
        uploadedAt: new Date(),
      });
      await student.save();
    } catch (dbErr) {
      await uploadService.deleteFile(saved.filename, 'documents');
      throw dbErr;
    }

    res.status(201).json({
      success: true,
      message: 'Student document uploaded',
      data: student.documents,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Delete student document
 * @route   DELETE /api/v1/students/:id/documents/:documentId
 * @access  Private (Staff with students.update)
 */
exports.deleteStudentDocument = async (req, res, next) => {
  try {
    const Student = require('../models/Student');
    const student = await Student.findById(req.params.id);
    if (!student) {
      return next(new ErrorResponse('Student not found', 404));
    }
    const doc = student.documents.id
      ? student.documents.id(req.params.documentId)
      : (student.documents || []).find(d => String(d._id) === String(req.params.documentId));
    if (!doc) {
      return next(new ErrorResponse('Document not found', 404));
    }
    const docUrl = doc.url;
    if (student.documents.pull) {
      student.documents.pull(req.params.documentId);
    } else {
      student.documents = student.documents.filter(d => String(d._id) !== String(req.params.documentId));
    }
    await student.save();

    if (docUrl) {
      const uploadService = require('../services/upload.service');
      await uploadService.safeDeleteOldUpload(docUrl);
    }

    res.status(200).json({
      success: true,
      message: 'Student document deleted',
      data: student.documents,
    });
  } catch (err) {
    next(err);
  }
};
