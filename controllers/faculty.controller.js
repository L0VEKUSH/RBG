const User = require('../models/User');
const Faculty = require('../models/Faculty');
const Class = require('../models/Class');
const ErrorResponse = require('../utils/errorResponse');
const APIFeatures = require('../utils/apiFeatures');
const logger = require('../utils/logger');
const facultyLeaveService = require('../services/faculty-leave.service');

function assertNoEmbeddedLeaveMutation(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    const parts = key.split('.');
    if (parts.includes('leaves')) throw new ErrorResponse('Faculty leave records must use the leave workflow', 400);
    if (key === '$rename' && nested && typeof nested === 'object') {
      const renamedLeavePath = Object.entries(nested).some(([source, destination]) =>
        source.split('.').includes('leaves') ||
        (typeof destination === 'string' && destination.split('.').includes('leaves'))
      );
      if (renamedLeavePath) throw new ErrorResponse('Faculty leave records must use the leave workflow', 400);
    }
    assertNoEmbeddedLeaveMutation(nested);
  }
}

/**
 * @desc    Create faculty member
 * @route   POST /api/v1/faculty
 * @access  Private (Admin)
 */
exports.createFaculty = async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Password-based account creation is disabled. Use the Teacher invitation workflow; the account owner sets their password during activation.',
  });
};

/**
 * @desc    Get all faculty
 * @route   GET /api/v1/faculty
 * @access  Private (Admin)
 */
exports.getAllFaculty = async (req, res) => {
  const baseQuery = Faculty.find({ isActive: true })
    .populate('user', 'name email phone profilePhoto gender');

  const features = new APIFeatures(baseQuery, req.query)
    .search(['employeeId', 'department', 'designation', 'qualifications'])
    .filter()
    .sort()
    .paginate();
  const faculty = await features.query;
  const total = await Faculty.countDocuments({ isActive: true });

  res.status(200).json({
    success: true,
    count: faculty.length,
    total,
    page: features.page,
    limit: features.limit,
    data: { faculty },
  });
};

/**
 * @desc    Get single faculty
 * @route   GET /api/v1/faculty/:id
 * @access  Private (Admin, Self)
 */
exports.getFacultyById = async (req, res) => {
  const faculty = await Faculty.findById(req.params.id)
    .populate('user', '-password -resetPasswordToken -resetPasswordExpire');
  if (!faculty) throw new ErrorResponse(`Faculty not found: ${req.params.id}`, 404);
  res.status(200).json({ success: true, data: { faculty } });
};

/**
 * @desc    Update faculty
 * @route   PUT /api/v1/faculty/:id
 * @access  Private (Admin)
 */
exports.updateFaculty = async (req, res) => {
  assertNoEmbeddedLeaveMutation(req.body);
  if (req.body.section !== undefined || req.body.sections !== undefined) {
    throw new ErrorResponse('Class sections are not supported. RBG School ERP models single undivided classes per level.', 400);
  }
  const faculty = await Faculty.findById(req.params.id);
  if (!faculty) throw new ErrorResponse(`Faculty not found: ${req.params.id}`, 404);

  const { name, email, phone, address, gender, profilePhoto, ...facultyData } = req.body;

  if (facultyData.classTeacherOf && facultyData.classTeacherOf.class) {
    try {
      facultyData.classTeacherOf.class = Class.validateAndNormalizeClassWrite(facultyData.classTeacherOf.class, 'classTeacherOf.class');
    } catch (err) {
      throw new ErrorResponse(err.message, 400);
    }
  }
  if (Array.isArray(facultyData.subjects)) {
    for (const sub of facultyData.subjects) {
      if (Array.isArray(sub.classes)) {
        try {
          sub.classes = sub.classes.map(c => Class.validateAndNormalizeClassWrite(c, 'subject class'));
        } catch (err) {
          throw new ErrorResponse(err.message, 400);
        }
      }
    }
  }

  if (name || email || phone || address || gender || profilePhoto) {
    await User.findByIdAndUpdate(faculty.user, {
      ...(name && { name }), ...(email && { email }),
      ...(phone && { phone }), ...(address && { address }),
      ...(gender && { gender }), ...(profilePhoto && { profilePhoto }),
    }, { runValidators: true });
  }

  const updatedFaculty = await Faculty.findByIdAndUpdate(req.params.id, facultyData, {
    new: true, runValidators: true,
  }).populate('user', '-password');

  res.status(200).json({ success: true, message: 'Faculty updated', data: { faculty: updatedFaculty } });
};

/**
 * @desc    Delete (deactivate) faculty
 * @route   DELETE /api/v1/faculty/:id
 * @access  Private (Admin)
 */
exports.deleteFaculty = async (req, res) => {
  const faculty = await Faculty.findById(req.params.id);
  if (!faculty) throw new ErrorResponse(`Faculty not found: ${req.params.id}`, 404);
  faculty.isActive = false;
  await faculty.save();
  await User.findByIdAndUpdate(faculty.user, { isActive: false });
  res.status(200).json({ success: true, message: 'Faculty deactivated successfully' });
};

/**
 * @desc    Get my faculty profile
 * @route   GET /api/v1/faculty/my-profile
 * @access  Private (Faculty)
 */
exports.getMyProfile = async (req, res) => {
  const faculty = await Faculty.findOne({ user: req.user.id })
    .populate('user', '-password');
  if (!faculty) throw new ErrorResponse('Faculty profile not found', 404);
  res.status(200).json({ success: true, data: { faculty } });
};

/**
 * @desc    Apply for leave
 * @route   POST /api/v1/faculty/:id/leave
 * @access  Private (Faculty)
 */
exports.applyLeave = async (req, res) => {
  const leave = await facultyLeaveService.applyFacultyLeave(req.params.id, req.user, req.body);
  res.status(201).json({ success: true, message: 'Leave application submitted', data: { leave } });
};

/**
 * @desc    Update leave status
 * @route   PUT /api/v1/faculty/:id/leave/:leaveId
 * @access  Private (Admin)
 */
exports.updateLeaveStatus = async (req, res) => {
  const leave = await facultyLeaveService.updateFacultyLeaveStatus(
    req.params.id, req.params.leaveId, req.body.status, req.user
  );
  res.status(200).json({ success: true, message: 'Leave status updated', data: { leave } });
};

/**
 * @desc    Get faculty stats
 * @route   GET /api/v1/faculty/stats
 * @access  Private (Admin)
 */
exports.getFacultyStats = async (req, res) => {
  const [total, byDept, byDesignation] = await Promise.all([
    Faculty.countDocuments({ isActive: true }),
    Faculty.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Faculty.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$designation', count: { $sum: 1 } } },
    ]),
  ]);
  res.status(200).json({ success: true, data: { total, byDept, byDesignation } });
};
