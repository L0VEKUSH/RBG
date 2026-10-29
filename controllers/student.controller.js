const studentService = require('../services/student.service');

/**
 * @desc    Create student
 * @route   POST /api/v1/students
 * @access  Private (Admin)
 */
exports.createStudent = async (req, res, next) => {
  const student = await studentService.createStudent(req.body, req.user.id);
  res.status(201).json({ success: true, message: 'Student created successfully', data: { student } });
};

/**
 * @desc    Get all students
 * @route   GET /api/v1/students
 * @access  Private (Admin, Faculty)
 */
exports.getAllStudents = async (req, res) => {
  
  // Scope the query based on role
  if (['teacher', 'class_teacher', 'faculty'].includes(req.user.role)) {
    const Faculty = require('../models/Faculty');
    const SubjectAllocation = require('../models/SubjectAllocation');
    const faculty = await Faculty.findOne({ user: req.user._id });
    if (faculty) {
      let allowedClasses = [];
      if (faculty.classTeacherOf && faculty.classTeacherOf.class) allowedClasses.push(faculty.classTeacherOf.class);
      const allocations = await SubjectAllocation.find({ teacher: faculty._id }).distinct('class');
      allowedClasses = [...new Set([...allowedClasses, ...allocations])];
      
      req.query.class = { $in: allowedClasses };
    }
  } else if (req.user.role === 'parent') {
    const Parent = require('../models/Parent');
    const parent = await Parent.findOne({ user: req.user._id });
    if (parent && parent.children) {
      req.query._id = { $in: parent.children };
    }
  } else if (req.user.role === 'student') {
    const Student = require('../models/Student');
    const st = await Student.findOne({ user: req.user._id });
    if (st) {
      req.query._id = st._id;
    }
  }
  
  const result = await studentService.getAllStudents(req.query);

  res.status(200).json({ success: true, ...result });
};

/**
 * @desc    Get student by ID
 * @route   GET /api/v1/students/:id
 * @access  Private
 */
exports.getStudentById = async (req, res) => {
  const student = await studentService.getStudentById(req.params.id);
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
  const students = await studentService.getStudentsByClass(req.params.class, academicYear);
  res.status(200).json({ success: true, count: students.length, data: { students } });
};

/**
 * @desc    Promote students
 * @route   POST /api/v1/students/promote
 * @access  Private (Admin)
 */
exports.promoteStudents = async (req, res) => {
  const { studentIds, newClass, newAcademicYear } = req.body;
  const students = await studentService.promoteStudents(studentIds, newClass, newAcademicYear);
  res.status(200).json({ success: true, message: `${students.length} students promoted`, data: { students } });
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
exports.updateFeePayment = async (req, res) => {
  const student = await studentService.updateFeePayment(req.params.id, req.body.amount);
  res.status(200).json({ success: true, message: 'Fee payment updated', data: { student } });
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
