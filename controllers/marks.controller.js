const Marks = require('../models/Marks');
const Student = require('../models/Student');
const ErrorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');
const marksService = require('../services/marks.service');

/**
 * @desc    Add/update marks for a student
 * @route   POST /api/v1/marks
 * @access  Private (Admin, Faculty)
 */
exports.addMarks = async (req, res) => {
  const { record, created } = await marksService.addOrUpdateMarks(req.body, req.user);
  logger.info(`Marks ${created ? 'added' : 'updated'} for student ${record.student}, exam: ${record.examType}`);
  res.status(created ? 201 : 200).json({
    success: true,
    message: created ? 'Marks added successfully' : 'Marks updated',
    data: { marks: record },
  });
};

/**
 * @desc    Get marks for a student
 * @route   GET /api/v1/marks/student/:studentId
 * @access  Private
 */
exports.getStudentMarks = async (req, res) => {
  const { academicYear, examType } = req.query;
  const query = { student: req.params.studentId };
  if (academicYear) query.academicYear = academicYear;
  if (examType) query.examType = examType;

  // IDOR protection: students can only view their own marks
  if (req.user.role === 'student') {
    const student = await Student.findOne({ user: req.user.id });
    if (!student) throw new ErrorResponse('Student profile not found', 404);
    if (student._id.toString() !== req.params.studentId) {
      throw new ErrorResponse('Access denied. You can only view your own marks.', 403);
    }
    query.isPublished = true; // students only see published
  }

  // IDOR protection: parents can only view their children's marks
  if (req.user.role === 'parent') {
    const Parent = require('../models/Parent');
    const parent = await Parent.findOne({ user: req.user.id });
    if (!parent) throw new ErrorResponse('Parent profile not found', 404);
    const childIds = parent.children.map(id => id.toString());
    if (!childIds.includes(req.params.studentId)) {
      throw new ErrorResponse('Access denied. You can only view your children\'s marks.', 403);
    }
    query.isPublished = true; // parents only see published
  }

  const marks = await Marks.find(query)
    .populate('student', 'admissionNumber class  rollNumber')
    .populate('markedBy', 'name')
    .sort('-createdAt');

  res.status(200).json({ success: true, count: marks.length, data: { marks } });
};


/**
 * @desc    Get class marks for an exam
 * @route   GET /api/v1/marks/class/:class
 * @access  Private (Admin, Faculty)
 */
exports.getClassMarks = async (req, res) => {
  const rawClass = req.params?.class ?? req.query?.class;
  const cls = typeof rawClass === 'string' ? rawClass.trim() : '';
  if (!cls) {
    throw new ErrorResponse('Class is required', 400);
  }

  const { examType, academicYear } = req.query || {};
  const query = { class: cls, isPublished: true };
  if (examType) query.examType = examType;
  if (academicYear) query.academicYear = academicYear;

  const marks = await Marks.find(query)
    .populate({ path: 'student', populate: { path: 'user', select: 'name' } })
    .sort('rank');

  res.status(200).json({ success: true, count: marks.length, data: { marks } });
};

/**
 * @desc    Publish marks
 * @route   PUT /api/v1/marks/publish
 * @access  Private (Admin)
 */
exports.publishMarks = async (req, res) => {
  const { class: cls, examType, academicYear } = req.body;
  if (!cls || !examType || !academicYear) throw new ErrorResponse('Class, exam type, and academic year are required', 400);
  const result = await Marks.updateMany(
    { class: cls, examType, academicYear, isPublished: false },
    { isPublished: true, publishedAt: new Date(), publishedBy: req.user._id }
  );
  res.status(200).json({
    success: true,
    message: `${result.modifiedCount} mark records published`,
  });
};

/**
 * @desc    Compute class rank
 * @route   POST /api/v1/marks/rank
 * @access  Private (Admin)
 */
exports.computeRank = async (req, res) => {
  const { class: cls, examType, academicYear } = req.body;
  const allMarks = await Marks.find({ class: cls, examType, academicYear })
    .sort('-percentage');

  const rankUpdates = allMarks.map((m, idx) =>
    Marks.findByIdAndUpdate(m._id, { rank: idx + 1 })
  );
  await Promise.all(rankUpdates);

  res.status(200).json({ success: true, message: `Ranks computed for ${allMarks.length} students` });
};

/**
 * @desc    Get my marks (student)
 * @route   GET /api/v1/marks/my-marks
 * @access  Private (Student)
 */
exports.getMyMarks = async (req, res) => {
  const student = await Student.findOne({ user: req.user.id });
  if (!student) throw new ErrorResponse('Student profile not found', 404);

  const query = { student: student._id, isPublished: true };
  if (typeof req.query.examType === 'string' && req.query.examType.trim()) {
    query.examType = req.query.examType;
  }
  if (typeof req.query.academicYear === 'string' && /^\d{4}-\d{4}$/.test(req.query.academicYear)) {
    query.academicYear = req.query.academicYear;
  }
  const marks = await Marks.find(query)
    .sort('-createdAt');
  res.status(200).json({ success: true, count: marks.length, data: { marks } });
};

/**
 * @desc    Delete marks record
 * @route   DELETE /api/v1/marks/:id
 * @access  Private (Admin)
 */
exports.deleteMarks = async (req, res) => {
  const marks = await Marks.findByIdAndDelete(req.params.id);
  if (!marks) throw new ErrorResponse('Marks record not found', 404);
  res.status(200).json({ success: true, message: 'Marks record deleted' });
};

/**
 * @desc    Get marks statistics for class
 * @route   GET /api/v1/marks/stats
 * @access  Private (Admin, Faculty)
 */
exports.getClassStats = async (req, res) => {
  const { class: cls, examType, academicYear } = req.query;
  const stats = await Marks.aggregate([
    { $match: { class: cls, examType, academicYear, isPublished: true } },
    {
      $group: {
        _id: null,
        avgPercentage: { $avg: '$percentage' },
        maxPercentage: { $max: '$percentage' },
        minPercentage: { $min: '$percentage' },
        passCount: { $sum: { $cond: [{ $eq: ['$result', 'Pass'] }, 1, 0] } },
        failCount: { $sum: { $cond: [{ $eq: ['$result', 'Fail'] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
  ]);

  res.status(200).json({ success: true, data: { stats: stats[0] || {} } });
};
