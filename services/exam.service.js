const Exam = require('../models/Exam');
const Student = require('../models/Student');

exports.getAllExams = async () => {
    return await Exam.find().populate('subject');
};

exports.createExam = async (data) => {
    return await Exam.create(data);
};

exports.getUpcomingExams = async (userRole, userId) => {
    let filter = { date: { $gte: new Date() } };
    if (userRole === 'student') {
        const student = await Student.findOne({ user: userId });
        if (student) {
            filter.classLevel = student.classLevel; // Simplified matching
        }
    }
    return await Exam.find(filter).populate('subject').sort({ date: 1 });
};

exports.getExamsByClass = async (classLevel) => {
    return await Exam.find({ classLevel }).populate('subject');
};

exports.getExamById = async (id) => {
    return await Exam.findById(id).populate('subject');
};

exports.updateExam = async (id, data) => {
    return await Exam.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};

exports.deleteExam = async (id) => {
    return await Exam.findByIdAndDelete(id);
};
