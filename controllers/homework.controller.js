const homeworkService = require('../services/homework.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getHomework = async (req, res, next) => {
    try {
        const filters = req.user.role === 'teacher' ? { createdBy: req.user._id } : {};
        const hw = await homeworkService.getAllHomework(filters);
        res.status(200).json({ success: true, message: 'Homework retrieved', data: hw, count: hw.length });
    } catch (error) { next(error); }
};

exports.createHomework = async (req, res, next) => {
    try {
        const hw = await homeworkService.createHomework({
            ...req.body,
            teacher: req.user._id,    // Homework model requires teacher (ObjectId ref to User)
            createdBy: req.user._id,  // keep for audit
        });
        res.status(201).json({ success: true, message: 'Homework created', data: hw });
    } catch (error) { next(error); }
};

exports.getMyHomework = async (req, res, next) => {
    try {
        const hw = await homeworkService.getStudentHomework(req.user._id);
        res.status(200).json({ success: true, message: 'Homework retrieved', data: hw, count: hw.length });
    } catch (error) { next(error); }
};

exports.getClassHomework = async (req, res, next) => {
    try {
        const hw = await homeworkService.getHomeworkByClass(req.params.class);
        res.status(200).json({ success: true, message: 'Homework retrieved', data: hw, count: hw.length });
    } catch (error) { next(error); }
};

exports.getHomeworkById = async (req, res, next) => {
    try {
        const hw = await homeworkService.getHomeworkById(req.params.id);
        if (!hw) return next(new ErrorResponse('Homework not found', 404));
        res.status(200).json({ success: true, message: 'Homework retrieved', data: hw });
    } catch (error) { next(error); }
};

exports.updateHomework = async (req, res, next) => {
    try {
        const hw = await homeworkService.updateHomework(req.params.id, req.body);
        res.status(200).json({ success: true, message: 'Homework updated', data: hw });
    } catch (error) { next(error); }
};

exports.deleteHomework = async (req, res, next) => {
    try {
        await homeworkService.deleteHomework(req.params.id);
        res.status(200).json({ success: true, message: 'Homework deleted', data: {} });
    } catch (error) { next(error); }
};

exports.submitHomework = async (req, res, next) => {
    try {
        const submission = await homeworkService.submitHomework(req.params.id, req.user._id, req.body);
        res.status(201).json({ success: true, message: 'Homework submitted', data: submission });
    } catch (error) { next(error); }
};

exports.reviewSubmission = async (req, res, next) => {
    try {
        const review = await homeworkService.reviewSubmission(req.params.id, req.params.submissionId, req.body);
        res.status(200).json({ success: true, message: 'Submission reviewed', data: review });
    } catch (error) { next(error); }
};
