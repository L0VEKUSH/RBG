const Timetable = require('../models/Timetable');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');

exports.getTimetable = async () => {
    return await Timetable.find().populate('periods.teacher', 'user designation');
};

exports.createTimetable = async (data) => {
    return await Timetable.create(data);
};

exports.updateTimetable = async (id, data) => {
    return await Timetable.findByIdAndUpdate(id, data, { new: true });
};

exports.getTimetableByClass = async (classLevel) => {
    // Model field is 'class', not 'classLevel'
    return await Timetable.find({ class: classLevel }).populate('periods.teacher', 'user designation');
};

exports.getTimetableByTeacher = async (teacherId) => {
    // Find faculty record for this user, then find timetable periods assigned to that faculty
    const faculty = await Faculty.findOne({ user: teacherId });
    if (!faculty) return [];
    return await Timetable.find({ 'periods.teacher': faculty._id });
};

exports.getMyTimetable = async (userId, role) => {
    if (role === 'student') {
        const student = await Student.findOne({ user: userId });
        if (!student) return [];
        return await Timetable.find({ class: student.class }).populate('periods.teacher', 'user');
    } else if (role === 'teacher' || role === 'class_teacher') {
        const faculty = await Faculty.findOne({ user: userId });
        if (!faculty) return [];
        return await Timetable.find({ 'periods.teacher': faculty._id });
    }
    return [];
};
