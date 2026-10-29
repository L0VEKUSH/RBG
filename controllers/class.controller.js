const classService = require('../services/class.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getClasses = async (req, res, next) => {
    try {
        const classes = await classService.getAllClasses();
        res.status(200).json({ success: true, message: 'Classes retrieved', data: classes, count: classes.length });
    } catch (error) { next(error); }
};

exports.createClass = async (req, res, next) => {
    try {
        const cls = await classService.createClass(req.body);
        res.status(201).json({ success: true, message: 'Class created', data: cls });
    } catch (error) { next(error); }
};

exports.getClass = async (req, res, next) => {
    try {
        const cls = await classService.getClassById(req.params.id);
        if (!cls) return next(new ErrorResponse('Class not found', 404));
        res.status(200).json({ success: true, message: 'Class retrieved', data: cls });
    } catch (error) { next(error); }
};

exports.updateClass = async (req, res, next) => {
    try {
        const cls = await classService.updateClass(req.params.id, req.body);
        if (!cls) return next(new ErrorResponse('Class not found', 404));
        res.status(200).json({ success: true, message: 'Class updated', data: cls });
    } catch (error) { next(error); }
};

exports.deleteClass = async (req, res, next) => {
    try {
        await classService.deleteClass(req.params.id);
        res.status(200).json({ success: true, message: 'Class deleted', data: {} });
    } catch (error) { next(error); }
};

exports.getClassStudents = async (req, res, next) => {
    try {
        const students = await classService.getStudentsInClass(req.params.id);
        res.status(200).json({ success: true, message: 'Students retrieved', data: students, count: students.length });
    } catch (error) { next(error); }
};
