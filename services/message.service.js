const Message = require('../models/Message');

exports.getMyMessages = async (userId) => {
    return await Message.find({ $or: [{ sender: userId }, { receiver: userId }] })
        .populate('sender', 'firstName lastName')
        .populate('receiver', 'firstName lastName')
        .sort({ createdAt: -1 });
};

exports.sendMessage = async (data) => {
    return await Message.create(data);
};

exports.getMessageThread = async (messageId) => {
    return await Message.findById(messageId).populate('sender receiver', 'firstName lastName');
};

exports.markAsRead = async (id, userId) => {
    return await Message.findOneAndUpdate(
        { _id: id, receiver: userId },
        { isRead: true },
        { new: true }
    );
};

exports.getUnreadCount = async (userId) => {
    return await Message.countDocuments({ receiver: userId, isRead: false });
};
