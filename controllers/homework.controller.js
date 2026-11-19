const homeworkService = require('../services/homework.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getHomework = async (req, res, next) => {
    try {
        const filters = {};
        for (const field of ['class', 'academicYear', 'studentId']) {
            if (typeof req.query[field] === 'string' && req.query[field].trim()) filters[field] = req.query[field].trim();
        }
        const hw = await homeworkService.getHomework(filters, req.user);
        res.status(200).json({ success: true, message: 'Homework retrieved', data: hw, count: hw.length });
    } catch (error) { next(error); }
};

exports.createHomework = async (req, res, next) => {
    try {
        const { title, description, class: classLevel, subject, dueDate, attachments, academicYear } = req.body || {};
        const hw = await homeworkService.createHomework({
            title,
            description,
            class: classLevel,
            subject,
            dueDate,
            attachments,
            academicYear,
            teacher: req.user._id,
        }, req.user);
        res.status(201).json({ success: true, message: 'Homework created', data: hw });
    } catch (error) { next(error); }
};

exports.getMyHomework = async (req, res, next) => {
    try {
        const hw = await homeworkService.getStudentHomework(req.user);
        res.status(200).json({ success: true, message: 'Homework retrieved', data: hw, count: hw.length });
    } catch (error) { next(error); }
};

exports.getClassHomework = async (req, res, next) => {
    try {
        const hw = await homeworkService.getHomeworkByClass(req.params.class, req.user);
        res.status(200).json({ success: true, message: 'Homework retrieved', data: hw, count: hw.length });
    } catch (error) { next(error); }
};

exports.getHomeworkById = async (req, res, next) => {
    try {
        const filters = typeof req.query.studentId === 'string' ? { studentId: req.query.studentId } : {};
        const hw = await homeworkService.getHomeworkById(req.params.id, req.user, filters);
        if (!hw) return next(new ErrorResponse('Homework not found', 404));
        res.status(200).json({ success: true, message: 'Homework retrieved', data: hw });
    } catch (error) { next(error); }
};

exports.updateHomework = async (req, res, next) => {
    try {
        const hw = await homeworkService.updateHomework(req.params.id, req.user, req.body);
        res.status(200).json({ success: true, message: 'Homework updated', data: hw });
    } catch (error) { next(error); }
};

exports.deleteHomework = async (req, res, next) => {
    try {
        await homeworkService.deleteHomework(req.params.id, req.user);
        res.status(200).json({ success: true, message: 'Homework deleted', data: {} });
    } catch (error) { next(error); }
};

exports.submitHomework = async (req, res, next) => {
    try {
        const result = await homeworkService.submitHomework(
            req.params.id,
            req.user,
            req.homeworkSubmission || req.body
        );
        res.status(result.created ? 201 : 200).json({
            success: true,
            message: 'Homework submission saved',
            data: result.submission,
        });
    } catch (error) { next(error); }
};

exports.reviewSubmission = async (req, res, next) => {
    try {
        const review = await homeworkService.reviewSubmission(req.params.id, req.params.submissionId, req.body, req.user);
        res.status(200).json({ success: true, message: 'Submission reviewed', data: review });
    } catch (error) { next(error); }
};

exports.uploadHomeworkAttachment = async (req, res, next) => {
    try {
        if (!req.file) {
            return next(new ErrorResponse('Please select an attachment to upload', 400));
        }
        const Homework = require('../models/Homework');
        const uploadService = require('../services/upload.service');
        const path = require('path');
        const hw = await Homework.findById(req.params.id);
        if (!hw) {
            return next(new ErrorResponse('Homework not found', 404));
        }
        const role = String(req.user?.role || '').toLowerCase();
        const isManager = ['super_admin', 'school_admin', 'admin', 'principal'].includes(role);
        const isOwner = String(hw.teacher) === String(req.user._id || req.user.id);
        if (!isManager && !isOwner) {
            return next(new ErrorResponse('Not authorized to modify this homework', 403));
        }

        const saved = await uploadService.saveFile(req.file, 'attachments');
        try {
            const attName = (req.body && typeof req.body.name === 'string' && req.body.name.trim())
                ? req.body.name.trim()
                : req.file.originalname || 'Attachment';
            const ext = path.extname(saved.filename).slice(1) || 'file';
            hw.attachments.push({
                name: attName,
                url: saved.url,
                type: ext,
            });
            await hw.save();
        } catch (dbErr) {
            await uploadService.deleteFile(saved.filename, 'attachments');
            throw dbErr;
        }

        res.status(201).json({
            success: true,
            message: 'Homework attachment uploaded',
            data: hw.attachments,
        });
    } catch (error) { next(error); }
};
