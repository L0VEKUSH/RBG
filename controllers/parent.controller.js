const parentService = require('../services/parent.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getParents = async (req, res, next) => {
    try {
        const parents = await parentService.getAllParents();
        res.status(200).json({ success: true, message: 'Parents retrieved', data: parents, count: parents.length });
    } catch (error) { next(error); }
};

exports.getMyChildren = async (req, res, next) => {
    try {
        const children = await parentService.getChildrenForParent(req.user._id);
        res.status(200).json({ success: true, message: 'Children retrieved', data: children, count: children.length });
    } catch (error) { next(error); }
};

exports.createParent = async (req, res, next) => {
    try {
        const parent = await parentService.createParent(req.body.parentData, req.body.userData);
        res.status(201).json({ success: true, message: 'Parent created', data: parent });
    } catch (error) { next(error); }
};

exports.getParent = async (req, res, next) => {
    try {
        const parent = await parentService.getParentById(req.params.id);
        if (!parent) return next(new ErrorResponse('Parent not found', 404));
        res.status(200).json({ success: true, message: 'Parent retrieved', data: parent });
    } catch (error) { next(error); }
};

exports.updateParent = async (req, res, next) => {
    try {
        const parent = await parentService.updateParent(req.params.id, req.body);
        res.status(200).json({ success: true, message: 'Parent updated', data: parent });
    } catch (error) { next(error); }
};

exports.getParentChildren = async (req, res, next) => {
    try {
        const parent = await parentService.getParentById(req.params.id);
        if(!parent) return next(new ErrorResponse('Parent not found', 404));
        const children = await parentService.getChildrenForParent(parent.user);
        res.status(200).json({ success: true, message: 'Children retrieved', data: children, count: children.length });
    } catch (error) { next(error); }
};
