const leaveService = require('../services/leave.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getLeaves = async (req, res, next) => {
    try {
        if (['super_admin', 'school_admin', 'principal'].includes(req.user.role)) {
            const leaves = await leaveService.getAllLeaves();
            return res.status(200).json({ success: true, message: 'All leaves retrieved', data: leaves, count: leaves.length });
        }
        const leaves = await leaveService.getMyLeaves(req.user._id);
        res.status(200).json({ success: true, message: 'My leaves retrieved', data: leaves, count: leaves.length });
    } catch (error) { next(error); }
};

exports.applyLeave = async (req, res, next) => {
    try {
        const leave = await leaveService.applyLeave({ ...req.body, user: req.user._id });
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
        const leaves = await leaveService.getPendingLeaves();
        res.status(200).json({ success: true, message: 'Pending leaves retrieved', data: leaves, count: leaves.length });
    } catch (error) { next(error); }
};

exports.getLeave = async (req, res, next) => {
    try {
        const leave = await leaveService.getLeaveById(req.params.id);
        if (!leave) return next(new ErrorResponse('Leave not found', 404));
        res.status(200).json({ success: true, message: 'Leave retrieved', data: leave });
    } catch (error) { next(error); }
};

exports.updateLeaveStatus = async (req, res, next) => {
    try {
        const leave = await leaveService.updateLeaveStatus(req.params.id, req.body.status, req.user._id);
        res.status(200).json({ success: true, message: 'Leave status updated', data: leave });
    } catch (error) { next(error); }
};
