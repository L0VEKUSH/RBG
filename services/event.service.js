const Event = require('../models/Event');

exports.getPublicEvents = async () => {
    return await Event.find({ isPublic: true, date: { $gte: new Date() } }).sort({ date: 1 });
};

exports.getUpcomingEvents = async () => {
    return await Event.find({ date: { $gte: new Date() } }).sort({ date: 1 });
};

exports.getAllEvents = async () => {
    return await Event.find().sort({ date: -1 });
};

exports.createEvent = async (data) => {
    return await Event.create(data);
};

exports.getEventById = async (id) => {
    return await Event.findById(id);
};

exports.updateEvent = async (id, data) => {
    return await Event.findByIdAndUpdate(id, data, { new: true });
};

exports.deleteEvent = async (id) => {
    return await Event.findByIdAndDelete(id);
};
