const Leave = require('../models/LeaveRequest');

exports.getAllLeaves = async () => {
    return await Leave.find().populate('user', 'firstName lastName role');
};

exports.getMyLeaves = async (userId) => {
    return await Leave.find({ user: userId });
};

exports.getPendingLeaves = async () => {
    return await Leave.find({ status: 'Pending' }).populate('user', 'firstName lastName role');
};

exports.applyLeave = async (data) => {
    return await Leave.create(data);
};

exports.getLeaveById = async (id) => {
    return await Leave.findById(id).populate('user', 'firstName lastName role');
};

exports.updateLeaveStatus = async (id, status, reviewedBy) => {
    return await Leave.findByIdAndUpdate(id, { status, reviewedBy }, { new: true });
};
