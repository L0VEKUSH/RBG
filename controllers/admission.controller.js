const admissionService = require('../services/admission.service');
const ErrorResponse = require('../utils/errorResponse');

exports.applyForAdmission = async (req, res, next) => {
    try {
        // req.admissionPayload is the validated whitelist built by admission.routes.js middleware
        const payload = req.admissionPayload || req.body;
        const admission = await admissionService.applyForAdmission(payload);
        // Return only safe public fields — never expose internal IDs, reviewer info, etc.
        res.status(201).json({
            success: true,
            message: 'Your application has been received. The admission office will contact you shortly.',
            data: {
                applicationNumber: admission.applicationNumber,
                studentName: admission.studentName,
                classApplyingFor: admission.classApplyingFor,
                status: admission.status,
                appliedDate: admission.appliedDate,
            },
        });
    } catch (error) { next(error); }
};


exports.getAdmissions = async (req, res, next) => {
    try {
        const admissions = await admissionService.getAllAdmissions();
        res.status(200).json({ success: true, message: 'Admissions retrieved', data: admissions, count: admissions.length });
    } catch (error) { next(error); }
};

exports.getAdmissionStats = async (req, res, next) => {
    try {
        const stats = await admissionService.getAdmissionStats();
        res.status(200).json({ success: true, message: 'Stats retrieved', data: stats });
    } catch (error) { next(error); }
};

exports.getAdmission = async (req, res, next) => {
    try {
        const admission = await admissionService.getAdmissionById(req.params.id);
        if (!admission) return next(new ErrorResponse('Admission not found', 404));
        res.status(200).json({ success: true, message: 'Admission retrieved', data: admission });
    } catch (error) { next(error); }
};

exports.updateAdmission = async (req, res, next) => {
    try {
        const admission = await admissionService.updateAdmission(req.params.id, req.body);
        res.status(200).json({ success: true, message: 'Admission updated', data: admission });
    } catch (error) { next(error); }
};

exports.updateAdmissionStatus = async (req, res, next) => {
    try {
        const admission = await admissionService.updateAdmissionStatus(req.params.id, req.body.status);
        res.status(200).json({ success: true, message: 'Status updated', data: admission });
    } catch (error) { next(error); }
};

exports.admitStudent = async (req, res, next) => {
    try {
        const student = await admissionService.admitStudent(req.params.id);
        res.status(200).json({ success: true, message: 'Student admitted successfully', data: student });
    } catch (error) { next(error); }
};
