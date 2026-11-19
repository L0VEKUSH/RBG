const leaveService = require('../services/leave.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getLeaves = async (req, res, next) => {
    try {
        const leaves = await leaveService.getAllLeaves(req.user);
        res.status(200).json({ success: true, message: 'Leaves retrieved', data: leaves, count: leaves.length });
    } catch (error) { next(error); }
};

exports.applyLeave = async (req, res, next) => {
    try {
        const { startDate: rawStart, endDate: rawEnd, fromDate, toDate, leaveType, reason, documents } = req.body;
        // Resolve fromDate/toDate aliases; reject conflicting values
        if (fromDate && rawStart && fromDate !== rawStart) {
            return next(new ErrorResponse('Conflicting date fields: provide either startDate or fromDate, not both with different values.', 400));
        }
        if (toDate && rawEnd && toDate !== rawEnd) {
            return next(new ErrorResponse('Conflicting date fields: provide either endDate or toDate, not both with different values.', 400));
        }
        const startDate = rawStart || fromDate;
        const endDate = rawEnd || toDate;
        if (!startDate || !endDate) {
            return next(new ErrorResponse('startDate and endDate are required.', 400));
        }
        const payload = {
            leaveType,
            startDate,
            endDate,
            reason,
            documents,
            user: req.user._id,
            userRole: req.user.role,
            status: 'Pending',
        };
        if (req.user.role === 'student') {
            const Student = require('../models/Student');
            const student = await Student.findOne({ user: req.user._id }).select('_id');
            if (student) payload.student = student._id;
        }
        const leave = await leaveService.applyLeave(payload);
        res.status(201).json({ success: true, message: 'Leave applied', data: leave });
    } catch (error) { next(error); }
};

exports.getMyLeaves = async (req, res, next) => {
    try {
        const leaves = await leaveService.getMyLeaves(req.user._id);
        res.status(200).json({ success: true, message: 'Leaves retrieved', data: leaves, count: leaves.length });
    } catch (error) { next(error); }
};

exports.getPendingLeaves = async (req, res, next) => {
    try {
        const leaves = await leaveService.getPendingLeaves(req.user);
        res.status(200).json({ success: true, message: 'Pending leaves retrieved', data: leaves, count: leaves.length });
    } catch (error) { next(error); }
};

exports.getLeave = async (req, res, next) => {
    try {
        const leave = await leaveService.getLeaveById(req.params.id, req.user);
        if (!leave) return next(new ErrorResponse('Leave not found', 404));
        res.status(200).json({ success: true, message: 'Leave retrieved', data: leave });
    } catch (error) { next(error); }
};

exports.updateLeaveStatus = async (req, res, next) => {
    try {
        const leave = await leaveService.updateLeaveStatus(req.params.id, req.body.status, req.user);
        res.status(200).json({ success: true, message: 'Leave status updated', data: leave });
    } catch (error) { next(error); }
};
