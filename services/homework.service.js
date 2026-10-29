const Homework = require('../models/Homework');

const Student = require('../models/Student');

exports.getAllHomework = async (filters) => {
    return await Homework.find(filters).populate('subject').populate('createdBy', 'firstName lastName');
};

exports.createHomework = async (data) => {
    return await Homework.create(data);
};

exports.getStudentHomework = async (studentUserId) => {
    const student = await Student.findOne({ user: studentUserId });
    if (!student) return [];
    return await Homework.find({ classLevel: student.classLevel }).populate('subject'); // simplified matching
};

exports.getHomeworkByClass = async (classLevel) => {
    return await Homework.find({ classLevel}).populate('subject');
};

exports.getHomeworkById = async (id) => {
    return await Homework.findById(id).populate('subject');
};

exports.updateHomework = async (id, data) => {
    return await Homework.findByIdAndUpdate(id, data, { new: true });
};

exports.deleteHomework = async (id) => {
    return await Homework.findByIdAndDelete(id);
};

exports.submitHomework = async (homeworkId, studentUserId, data) => {
    const student = await Student.findOne({ user: studentUserId });
    if (!student) throw new Error('Student not found');
    return await HomeworkSubmission.create({ ...data, homework: homeworkId, student: student._id });
};

exports.reviewSubmission = async (homeworkId, submissionId, data) => {
    return await HomeworkSubmission.findOneAndUpdate(
        { _id: submissionId, homework: homeworkId },
        data,
        { new: true }
    );
};
