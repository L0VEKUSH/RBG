const Parent = require('../models/Parent');
const Student = require('../models/Student');
const ErrorResponse = require('../utils/errorResponse');
const PARENT_PROFILE_ADMIN_ROLES = new Set(['super_admin', 'school_admin', 'admin', 'principal']);

exports.getAllParents = async () => {
    return await Parent.find().populate('user', 'firstName lastName email phone');
};

exports.getChildrenForParent = async (parentUserId) => {
    const parent = await Parent.findOne({ user: parentUserId }).select('children');
    if (!parent) throw new ErrorResponse('Parent profile not found', 404);
    return await Student.find({
        isActive: true,
        $or: [
            { _id: { $in: parent.children || [] } },
            { parentUser: parentUserId },
        ],
    })
        .populate('user', 'name email phone profilePhoto');
};

exports.createParent = async (parentData, userData) => {
    throw new ErrorResponse(
        'Parent account creation is temporarily unavailable until a compliant invitation can safely verify the parent-to-child relationship.',
        410
    );
};

exports.getParentById = async (id, requester) => {
    if (!requester) throw new ErrorResponse('Not authenticated', 401);
    const isParent = requester.role === 'parent';
    if (!isParent && !PARENT_PROFILE_ADMIN_ROLES.has(requester.role)) {
        throw new ErrorResponse('Not authorized to access this parent profile', 403);
    }
    const parent = await Parent.findById(id).populate('user');
    if (!parent) return null;
    if (isParent) {
        const ownerId = parent.user && parent.user._id ? parent.user._id : parent.user;
        if (!ownerId || ownerId.toString() !== requester._id.toString()) return null;
    }
    return parent;
};

exports.updateParent = async (id, data, requester) => {
    if (!requester) throw new ErrorResponse('Not authenticated', 401);
    if (requester.role === 'parent') {
        const allowedFields = ['occupation', 'workAddress', 'relationship', 'emergencyPhone', 'alternatePhone'];
        const safeData = Object.fromEntries(
            allowedFields
                .filter((field) => Object.prototype.hasOwnProperty.call(data || {}, field))
                .map((field) => [field, data[field]])
        );
        return await Parent.findOneAndUpdate(
            { _id: id, user: requester._id },
            { $set: safeData },
            { new: true, runValidators: true }
        );
    }
    if (!PARENT_PROFILE_ADMIN_ROLES.has(requester.role)) {
        throw new ErrorResponse('Not authorized to update this parent profile', 403);
    }
    return await Parent.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};
