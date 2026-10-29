const AuditLog = require('../models/AuditLog');

exports.getLogs = async (filters, page = 1, limit = 50) => {
    const skip = (page - 1) * limit;
    const logs = await AuditLog.find(filters).populate('user', 'firstName lastName role').sort({ createdAt: -1 }).skip(skip).limit(limit);
    const total = await AuditLog.countDocuments(filters);
    return { logs, total, pages: Math.ceil(total / limit), currentPage: page };
};

exports.logAction = async (userId, action, resource, resourceId, details, req) => {
    try {
        await AuditLog.create({
            user: userId,
            action,
            resource,
            resourceId,
            details,
            ipAddress: req ? req.ip : null,
            userAgent: req ? req.get('user-agent') : null
        });
    } catch (error) {
        console.error('Failed to write audit log', error);
    }
};
