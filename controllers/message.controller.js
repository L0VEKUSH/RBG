const messageService = require('../services/message.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getMyMessages = async (req, res, next) => {
    try {
        const messages = await messageService.getMyMessages(req.user._id);
        res.status(200).json({ success: true, message: 'Messages retrieved', data: messages, count: messages.length });
    } catch (error) { next(error); }
};

exports.sendMessage = async (req, res, next) => {
    try {
        const message = await messageService.sendMessage({ ...req.body, sender: req.user._id });
        res.status(201).json({ success: true, message: 'Message sent', data: message });
    } catch (error) { next(error); }
};

exports.getMessageThread = async (req, res, next) => {
    try {
        const message = await messageService.getMessageThread(req.params.id);
        if (!message) return next(new ErrorResponse('Message not found', 404));
        if (message.sender._id.toString() !== req.user._id.toString() && message.receiver._id.toString() !== req.user._id.toString()) {
            return next(new ErrorResponse('Not authorized to view this message', 403));
        }
        res.status(200).json({ success: true, message: 'Message retrieved', data: message });
    } catch (error) { next(error); }
};

exports.markAsRead = async (req, res, next) => {
    try {
        const message = await messageService.markAsRead(req.params.id, req.user._id);
        res.status(200).json({ success: true, message: 'Message marked as read', data: message });
    } catch (error) { next(error); }
};

exports.getUnreadCount = async (req, res, next) => {
    try {
        const count = await messageService.getUnreadCount(req.user._id);
        res.status(200).json({ success: true, message: 'Unread count retrieved', data: { count } });
    } catch (error) { next(error); }
};
