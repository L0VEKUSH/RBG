const Notification = require('../models/Notification');

exports.getMyNotifications = async (userId) => {
    return await Notification.find({ recipient: userId }).sort({ createdAt: -1 });
};

exports.getUnreadCount = async (userId) => {
    return await Notification.countDocuments({ recipient: userId, isRead: false });
};

exports.markAsRead = async (id, userId) => {
    return await Notification.findOneAndUpdate({ _id: id, recipient: userId }, { isRead: true }, { new: true });
};

exports.markAllAsRead = async (userId) => {
    return await Notification.updateMany({ recipient: userId, isRead: false }, { isRead: true });
};

exports.createNotification = async (data) => {
    return await Notification.create(data);
};

exports.deleteNotification = async (id, userId) => {
    return await Notification.findOneAndDelete({ _id: id, recipient: userId });
};
