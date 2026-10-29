const Subject = require('../models/Subject');

exports.getAllSubjects = async () => {
    return await Subject.find();
};

exports.createSubject = async (data) => {
    return await Subject.create(data);
};

exports.getSubjectById = async (id) => {
    return await Subject.findById(id);
};

exports.updateSubject = async (id, data) => {
    return await Subject.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};

exports.deleteSubject = async (id) => {
    return await Subject.findByIdAndDelete(id);
};

exports.getSubjectsByClassLevel = async (classLevel) => {
    return await Subject.find({ classLevel });
};
