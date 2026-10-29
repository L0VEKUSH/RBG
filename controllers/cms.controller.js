const cmsService = require('../services/cms.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getContentByPage = async (req, res, next) => {
    try {
        const content = await cmsService.getContentByPage(req.params.page);
        if (!content) return next(new ErrorResponse('Content not found', 404));
        res.status(200).json({ success: true, message: 'Content retrieved', data: content });
    } catch (error) { next(error); }
};

exports.getAllContent = async (req, res, next) => {
    try {
        const content = await cmsService.getAllContent();
        res.status(200).json({ success: true, message: 'All content retrieved', data: content, count: content.length });
    } catch (error) { next(error); }
};

exports.updateContent = async (req, res, next) => {
    try {
        const content = await cmsService.updateContent(req.params.page, req.body);
        res.status(200).json({ success: true, message: 'Content updated', data: content });
    } catch (error) { next(error); }
};
