const User = require('../models/User');
const Student = require('../models/Student');
const ErrorResponse = require('../utils/errorResponse');
const APIFeatures = require('../utils/apiFeatures');
const logger = require('../utils/logger');

class StudentService {
  /**
   * Create student with linked User account
   */
  async createStudent(data, createdBy) {
    const { name, email, password, gender, dateOfBirth, phone, address, ...studentData } = data;

    // Check email uniqueness
    const existingUser = await User.findOne({ email });
    if (existingUser) throw new ErrorResponse('Email already in use', 400);

    // Create user
    const user = await User.create({
      name, email, password, gender, dateOfBirth, phone, address, role: 'student',
    });

    // Create student profile
    const student = await Student.create({ user: user._id, ...studentData });
    logger.info(`Student created: ${user.name} [${student.admissionNumber}] by ${createdBy}`);
    return student;
  }

  /**
   * Get all students with filters, sorting, pagination
   */
  async getAllStudents(queryString) {
    const baseQuery = Student.find({ isActive: true })
      .populate('user', 'name email phone profilePhoto gender dateOfBirth address');

    const features = new APIFeatures(baseQuery, queryString)
      .search(['admissionNumber', 'rollNumber', 'class', 'stream'])
      .filter()
      .sort()
      .limitFields()
      .paginate();

    const students = await features.query;
    const total = await Student.countDocuments({ isActive: true });

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
  async getStudentById(id) {
    const student = await Student.findById(id)
      .populate('user', '-password -resetPasswordToken -resetPasswordExpire');
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
    const student = await Student.findById(id);
    if (!student) throw new ErrorResponse(`Student not found with id: ${id}`, 404);

    const { name, email, phone, address, gender, dateOfBirth, profilePhoto, ...studentData } = data;

    // Update user info
    if (name || email || phone || address || gender || dateOfBirth || profilePhoto) {
      await User.findByIdAndUpdate(student.user, {
        ...(name && { name }),
        ...(email && { email }),
        ...(phone && { phone }),
        ...(address && { address }),
        ...(gender && { gender }),
        ...(dateOfBirth && { dateOfBirth }),
        ...(profilePhoto && { profilePhoto }),
      }, { runValidators: true });
    }

    // Update student info
    const updatedStudent = await Student.findByIdAndUpdate(id, studentData, {
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
  async getStudentsByClass(cls, academicYear) {
    const query = { class: cls, isActive: true };
    
    if (academicYear) query.academicYear = academicYear;

    return Student.find(query)
      .populate('user', 'name email phone profilePhoto gender')
      .sort('rollNumber');
  }

  /**
   * Promote students to next class
   */
  async promoteStudents(studentIds, newClass, newAcademicYear) {
    const classMap = { '1':'2','2':'3','3':'4','4':'5','5':'6','6':'7','7':'8','8':'9','9':'10','10':'11','11':'12' };
    const updates = await Promise.all(
      studentIds.map(async (id) => {
        const student = await Student.findById(id);
        if (!student) return null;
        
        student.enrollmentHistory.push({
          class: student.class,
          academicYear: student.academicYear,
          stream: student.stream,
          rollNumber: student.rollNumber
        });

        student.class = newClass || classMap[student.class] || student.class;
        student.academicYear = newAcademicYear;
        return student.save();
      })
    );
    logger.info(`${updates.filter(Boolean).length} students promoted`);
    return updates.filter(Boolean);
  }

  /**
   * Issue Transfer Certificate (TC)
   */
  async issueTC(id, tcDetails) {
    const student = await Student.findById(id);
    if (!student) throw new ErrorResponse(`Student not found with id: ${id}`, 404);

    if (student.tcIssued) throw new ErrorResponse(`TC already issued for this student`, 400);

    student.tcIssued = true;
    student.tcDate = new Date();
    student.remarks = tcDetails.remarks || 'TC Issued';
    student.isActive = false;

    student.enrollmentHistory.push({
      class: student.class,
      academicYear: student.academicYear,
      stream: student.stream,
      rollNumber: student.rollNumber
    });

    await student.save();
    
    await User.findByIdAndUpdate(student.user, { isActive: false });
    
    logger.info(`TC issued for student: ${id}`);
    return student;
  }

  /**
   * Update fee payment
   */
  async updateFeePayment(studentId, amount) {
    const student = await Student.findById(studentId);
    if (!student) throw new ErrorResponse('Student not found', 404);
    student.fees.paidFees += amount;
    await student.save();
    return student;
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
