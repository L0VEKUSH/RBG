const notificationService = require('../services/notification.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getMyNotifications = async (req, res, next) => {
    try {
        const notifications = await notificationService.getMyNotifications(req.user._id);
        res.status(200).json({ success: true, message: 'Notifications retrieved', data: notifications, count: notifications.length });
    } catch (error) { next(error); }
};

exports.getUnreadCount = async (req, res, next) => {
    try {
        const count = await notificationService.getUnreadCount(req.user._id);
        res.status(200).json({ success: true, message: 'Unread count retrieved', data: { count } });
    } catch (error) { next(error); }
};

exports.markAsRead = async (req, res, next) => {
    try {
        const notification = await notificationService.markAsRead(req.params.id, req.user._id);
        res.status(200).json({ success: true, message: 'Notification marked as read', data: notification });
    } catch (error) { next(error); }
};

exports.markAllAsRead = async (req, res, next) => {
    try {
        await notificationService.markAllAsRead(req.user._id);
        res.status(200).json({ success: true, message: 'All notifications marked as read', data: {} });
    } catch (error) { next(error); }
};

exports.createNotification = async (req, res, next) => {
    try {
        const notification = await notificationService.createNotification(req.body);
        res.status(201).json({ success: true, message: 'Notification created', data: notification });
    } catch (error) { next(error); }
};

exports.deleteNotification = async (req, res, next) => {
    try {
        await notificationService.deleteNotification(req.params.id, req.user._id);
        res.status(200).json({ success: true, message: 'Notification deleted', data: {} });
    } catch (error) { next(error); }
};
