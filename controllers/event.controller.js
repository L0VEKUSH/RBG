const eventService = require('../services/event.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getPublicEvents = async (req, res, next) => {
    try {
        const events = await eventService.getPublicEvents();
        res.status(200).json({ success: true, message: 'Public events retrieved', data: events, count: events.length });
    } catch (error) { next(error); }
};

exports.getUpcomingEvents = async (req, res, next) => {
    try {
        const events = await eventService.getUpcomingEvents();
        res.status(200).json({ success: true, message: 'Upcoming events retrieved', data: events, count: events.length });
    } catch (error) { next(error); }
};

exports.getEvents = async (req, res, next) => {
    try {
        const events = await eventService.getAllEvents();
        res.status(200).json({ success: true, message: 'Events retrieved', data: events, count: events.length });
    } catch (error) { next(error); }
};

exports.createEvent = async (req, res, next) => {
    try {
        const event = await eventService.createEvent(req.body);
        res.status(201).json({ success: true, message: 'Event created', data: event });
    } catch (error) { next(error); }
};

exports.getEvent = async (req, res, next) => {
    try {
        const event = await eventService.getEventById(req.params.id);
        if (!event) return next(new ErrorResponse('Event not found', 404));
        res.status(200).json({ success: true, message: 'Event retrieved', data: event });
    } catch (error) { next(error); }
};

exports.updateEvent = async (req, res, next) => {
    try {
        const event = await eventService.updateEvent(req.params.id, req.body);
        res.status(200).json({ success: true, message: 'Event updated', data: event });
    } catch (error) { next(error); }
};

exports.deleteEvent = async (req, res, next) => {
    try {
        await eventService.deleteEvent(req.params.id);
        res.status(200).json({ success: true, message: 'Event deleted', data: {} });
    } catch (error) { next(error); }
};
