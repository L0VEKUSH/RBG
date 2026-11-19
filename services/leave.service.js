const Leave = require('../models/LeaveRequest');
const ErrorResponse = require('../utils/errorResponse');
const { getRolePermissions } = require('../config/permissions');

function hasPermission(user, permission) {
    const permissions = new Set(getRolePermissions(user && user.role));
    for (const override of (user && user.permissions) || []) {
        if (override.startsWith('-')) permissions.delete(override.slice(1));
        else permissions.add(override);
    }
    return permissions.has('*') || permissions.has(permission);
}

function canReviewLeaves(user) {
    return hasPermission(user, 'leave.approve') || hasPermission(user, 'leave.reject');
}

exports.getAllLeaves = async (user) => {
    if (!canReviewLeaves(user) && !hasPermission(user, 'leave.view')) {
        throw new ErrorResponse('Not authorized to view leave requests', 403);
    }
    if (!canReviewLeaves(user)) return Leave.find({ user: user._id }).populate('user', 'name role');
    return await Leave.find().populate('user', 'name role');
};

exports.getMyLeaves = async (userId) => {
    return await Leave.find({ user: userId });
};

exports.getPendingLeaves = async (user) => {
    const filter = { status: 'Pending' };
    if (!canReviewLeaves(user)) filter.user = user._id;
    return await Leave.find(filter).populate('user', 'name role');
};

exports.applyLeave = async (data) => {
    return await Leave.create(data);
};

exports.getLeaveById = async (id, user) => {
    const filter = canReviewLeaves(user) ? { _id: id } : { _id: id, user: user._id };
    return await Leave.findOne(filter).populate('user', 'name role');
};

exports.updateLeaveStatus = async (id, status, reviewer) => {
    const requiredPermission = status === 'Approved' ? 'leave.approve' : status === 'Rejected' ? 'leave.reject' : null;
    if (!requiredPermission || !hasPermission(reviewer, requiredPermission)) {
        throw new ErrorResponse('Not authorized to set this leave status', 403);
    }
    const leave = await Leave.findOneAndUpdate(
        { _id: id, status: 'Pending' },
        { status, approvedBy: reviewer._id },
        { new: true, runValidators: true }
    );
    if (!leave) throw new ErrorResponse('Pending leave request not found', 404);
    return leave;
};
