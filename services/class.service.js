const Class = require('../models/Class');
const Student = require('../models/Student');

exports.getAllClasses = async () => {
    return await Class.find().populate('classTeacher', 'firstName lastName');
};

exports.createClass = async (data) => {
    return await Class.create(data);
};

exports.getClassById = async (id) => {
    return await Class.findById(id).populate('classTeacher', 'firstName lastName');
};

exports.updateClass = async (id, data) => {
    return await Class.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};

exports.deleteClass = async (id) => {
    return await Class.findByIdAndDelete(id);
};

exports.getStudentsInClass = async (classId) => {
    return await Student.find({ currentClass: classId }).populate('user', 'firstName lastName rollNumber');
};
