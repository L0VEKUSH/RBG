const transportService = require('../services/transport.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getBuses = async (req, res, next) => {
    try {
        const buses = await transportService.getBuses();
        res.status(200).json({ success: true, message: 'Buses retrieved', data: buses, count: buses.length });
    } catch (error) { next(error); }
};

exports.addBus = async (req, res, next) => {
    try {
        const bus = await transportService.addBus(req.body);
        res.status(201).json({ success: true, message: 'Bus added', data: bus });
    } catch (error) { next(error); }
};

exports.updateBus = async (req, res, next) => {
    try {
        const bus = await transportService.updateBus(req.params.id, req.body);
        res.status(200).json({ success: true, message: 'Bus updated', data: bus });
    } catch (error) { next(error); }
};

exports.getRoutes = async (req, res, next) => {
    try {
        const routes = await transportService.getRoutes();
        res.status(200).json({ success: true, message: 'Routes retrieved', data: routes, count: routes.length });
    } catch (error) { next(error); }
};

exports.addRoute = async (req, res, next) => {
    try {
        const route = await transportService.addRoute(req.body);
        res.status(201).json({ success: true, message: 'Route added', data: route });
    } catch (error) { next(error); }
};

exports.updateRoute = async (req, res, next) => {
    try {
        const route = await transportService.updateRoute(req.params.id, req.body);
        res.status(200).json({ success: true, message: 'Route updated', data: route });
    } catch (error) { next(error); }
};

exports.assignStudent = async (req, res, next) => {
    try {
        const student = await transportService.assignStudent(req.body.studentId, req.body.routeId, req.body.busId);
        res.status(200).json({ success: true, message: 'Transport assigned', data: student });
    } catch (error) { next(error); }
};

exports.getStudentTransport = async (req, res, next) => {
    try {
        const transport = await transportService.getStudentTransport(req.params.studentId, req.user);
        res.status(200).json({ success: true, message: 'Student transport retrieved', data: transport });
    } catch (error) { next(error); }
};

exports.getMyTransport = async (req, res, next) => {
    try {
        const transport = await transportService.getMyTransport(req.user._id);
        res.status(200).json({ success: true, message: 'My transport retrieved', data: transport });
    } catch (error) { next(error); }
};

exports.getStats = async (req, res, next) => {
    try {
        const stats = await transportService.getStats();
        res.status(200).json({ success: true, message: 'Transport stats retrieved', data: stats });
    } catch (error) { next(error); }
};
