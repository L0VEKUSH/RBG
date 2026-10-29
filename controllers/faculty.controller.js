const User = require('../models/User');
const Faculty = require('../models/Faculty');
const ErrorResponse = require('../utils/errorResponse');
const APIFeatures = require('../utils/apiFeatures');
const logger = require('../utils/logger');

/**
 * @desc    Create faculty member
 * @route   POST /api/v1/faculty
 * @access  Private (Admin)
 */
exports.createFaculty = async (req, res) => {
  const { name, email, password, gender, dateOfBirth, phone, address, ...facultyData } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) throw new ErrorResponse('Email already in use', 400);

  const user = await User.create({
    name, email, password, gender, dateOfBirth, phone, address, role: 'faculty',
  });

  const faculty = await Faculty.create({ user: user._id, ...facultyData });
  logger.info(`Faculty created: ${user.name} [${faculty.employeeId}]`);

  res.status(201).json({ success: true, message: 'Faculty created successfully', data: { faculty } });
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
  const faculty = await Faculty.findById(req.params.id);
  if (!faculty) throw new ErrorResponse(`Faculty not found: ${req.params.id}`, 404);

  const { name, email, phone, address, gender, profilePhoto, ...facultyData } = req.body;

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
  const faculty = await Faculty.findById(req.params.id);
  if (!faculty) throw new ErrorResponse('Faculty not found', 404);

  faculty.leaves.push(req.body);
  await faculty.save();

  res.status(201).json({ success: true, message: 'Leave application submitted', data: { faculty } });
};

/**
 * @desc    Update leave status
 * @route   PUT /api/v1/faculty/:id/leave/:leaveId
 * @access  Private (Admin)
 */
exports.updateLeaveStatus = async (req, res) => {
  const faculty = await Faculty.findById(req.params.id);
  if (!faculty) throw new ErrorResponse('Faculty not found', 404);

  const leave = faculty.leaves.id(req.params.leaveId);
  if (!leave) throw new ErrorResponse('Leave record not found', 404);

  leave.status = req.body.status;
  await faculty.save();

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
