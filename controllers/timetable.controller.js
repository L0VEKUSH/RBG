const timetableService = require('../services/timetable.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getTimetable = async (req, res, next) => {
    try {
        const timetable = await timetableService.getTimetable();
        res.status(200).json({ success: true, message: 'Timetable retrieved', data: timetable, count: timetable.length });
    } catch (error) { next(error); }
};

exports.createTimetable = async (req, res, next) => {
    try {
        const timetable = await timetableService.createTimetable(req.body);
        res.status(201).json({ success: true, message: 'Timetable created', data: timetable });
    } catch (error) { next(error); }
};

exports.updateTimetable = async (req, res, next) => {
    try {
        const timetable = await timetableService.updateTimetable(req.params.id, req.body);
        if (!timetable) return next(new ErrorResponse('Timetable not found', 404));
        res.status(200).json({ success: true, message: 'Timetable updated', data: timetable });
    } catch (error) { next(error); }
};

exports.getClassTimetable = async (req, res, next) => {
    try {
        const academicYear = typeof req.query.academicYear === 'string' ? req.query.academicYear : undefined;
        const timetable = await timetableService.getTimetableByClass(req.params.class, academicYear, req.user);
        res.status(200).json({ success: true, message: 'Class timetable retrieved', data: timetable, count: timetable.length });
    } catch (error) { next(error); }
};

exports.getTeacherTimetable = async (req, res, next) => {
    try {
        const timetable = await timetableService.getTimetableByTeacher(req.params.teacherId, req.user);
        res.status(200).json({ success: true, message: 'Teacher timetable retrieved', data: timetable, count: timetable.length });
    } catch (error) { next(error); }
};

exports.getMyTimetable = async (req, res, next) => {
    try {
        const timetable = await timetableService.getMyTimetable(req.user._id, req.user.role);
        res.status(200).json({ success: true, message: 'My timetable retrieved', data: timetable, count: timetable.length });
    } catch (error) { next(error); }
};
