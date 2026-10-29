const Parent = require('../models/Parent');
const Student = require('../models/Student');
const User = require('../models/User');
const ErrorResponse = require('../utils/errorResponse');

exports.getAllParents = async () => {
    return await Parent.find().populate('user', 'firstName lastName email phone');
};

exports.getChildrenForParent = async (parentUserId) => {
    return await Student.find({ parentUser: parentUserId }).populate('user', 'firstName lastName email profileImage');
};

exports.createParent = async (parentData, userData) => {
    const user = await User.create({ ...userData, role: 'parent' });
    const parent = await Parent.create({ ...parentData, user: user._id });
    return parent;
};

exports.getParentById = async (id) => {
    return await Parent.findById(id).populate('user');
};

exports.updateParent = async (id, data) => {
    return await Parent.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};
