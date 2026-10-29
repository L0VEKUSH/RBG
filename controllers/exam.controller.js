const examService = require('../services/exam.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getExams = async (req, res, next) => {
    try {
        const exams = await examService.getAllExams();
        res.status(200).json({ success: true, message: 'Exams retrieved', data: exams, count: exams.length });
    } catch (error) { next(error); }
};

exports.createExam = async (req, res, next) => {
    try {
        const exam = await examService.createExam(req.body);
        res.status(201).json({ success: true, message: 'Exam created', data: exam });
    } catch (error) { next(error); }
};

exports.getUpcomingExams = async (req, res, next) => {
    try {
        const exams = await examService.getUpcomingExams(req.user.role, req.user._id);
        res.status(200).json({ success: true, message: 'Upcoming exams retrieved', data: exams, count: exams.length });
    } catch (error) { next(error); }
};

exports.getClassExams = async (req, res, next) => {
    try {
        const exams = await examService.getExamsByClass(req.params.class);
        res.status(200).json({ success: true, message: 'Class exams retrieved', data: exams, count: exams.length });
    } catch (error) { next(error); }
};

exports.getExamById = async (req, res, next) => {
    try {
        const exam = await examService.getExamById(req.params.id);
        if (!exam) return next(new ErrorResponse('Exam not found', 404));
        res.status(200).json({ success: true, message: 'Exam retrieved', data: exam });
    } catch (error) { next(error); }
};

exports.updateExam = async (req, res, next) => {
    try {
        const exam = await examService.updateExam(req.params.id, req.body);
        if (!exam) return next(new ErrorResponse('Exam not found', 404));
        res.status(200).json({ success: true, message: 'Exam updated', data: exam });
    } catch (error) { next(error); }
};

exports.deleteExam = async (req, res, next) => {
    try {
        await examService.deleteExam(req.params.id);
        res.status(200).json({ success: true, message: 'Exam deleted', data: {} });
    } catch (error) { next(error); }
};
