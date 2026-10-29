const auditLogService = require('../services/auditlog.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getAuditLogs = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const { resource, action } = req.query;
        let filters = {};
        if (resource) filters.resource = resource;
        if (action) filters.action = action;

        const data = await auditLogService.getLogs(filters, page, limit);
        res.status(200).json({ success: true, message: 'Audit logs retrieved', data: data.logs, count: data.logs.length, pagination: { total: data.total, pages: data.pages, currentPage: data.currentPage } });
    } catch (error) { next(error); }
};
