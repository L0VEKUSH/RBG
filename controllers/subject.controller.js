const subjectService = require('../services/subject.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getSubjects = async (req, res, next) => {
    try {
        const subjects = await subjectService.getAllSubjects();
        res.status(200).json({ success: true, message: 'Subjects retrieved', data: subjects, count: subjects.length });
    } catch (error) { next(error); }
};

exports.createSubject = async (req, res, next) => {
    try {
        const subject = await subjectService.createSubject(req.body);
        res.status(201).json({ success: true, message: 'Subject created', data: subject });
    } catch (error) { next(error); }
};

exports.getSubject = async (req, res, next) => {
    try {
        const subject = await subjectService.getSubjectById(req.params.id);
        if (!subject) return next(new ErrorResponse('Subject not found', 404));
        res.status(200).json({ success: true, message: 'Subject retrieved', data: subject });
    } catch (error) { next(error); }
};

exports.updateSubject = async (req, res, next) => {
    try {
        const subject = await subjectService.updateSubject(req.params.id, req.body);
        if (!subject) return next(new ErrorResponse('Subject not found', 404));
        res.status(200).json({ success: true, message: 'Subject updated', data: subject });
    } catch (error) { next(error); }
};

exports.deleteSubject = async (req, res, next) => {
    try {
        await subjectService.deleteSubject(req.params.id);
        res.status(200).json({ success: true, message: 'Subject deleted', data: {} });
    } catch (error) { next(error); }
};

exports.getSubjectsByClass = async (req, res, next) => {
    try {
        const subjects = await subjectService.getSubjectsByClassLevel(req.params.classLevel);
        res.status(200).json({ success: true, message: 'Subjects retrieved', data: subjects, count: subjects.length });
    } catch (error) { next(error); }
};
