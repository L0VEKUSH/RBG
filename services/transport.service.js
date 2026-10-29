const TransportBus = require('../models/Bus');
const TransportRoute = require('../models/Route');
const Student = require('../models/Student');

exports.getBuses = async () => {
    return await TransportBus.find();
};

exports.addBus = async (data) => {
    return await TransportBus.create(data);
};

exports.updateBus = async (id, data) => {
    return await TransportBus.findByIdAndUpdate(id, data, { new: true });
};

exports.getRoutes = async () => {
    return await TransportRoute.find();
};

exports.addRoute = async (data) => {
    return await TransportRoute.create(data);
};

exports.updateRoute = async (id, data) => {
    return await TransportRoute.findByIdAndUpdate(id, data, { new: true });
};

exports.assignStudent = async (studentId, routeId, busId) => {
    return await Student.findByIdAndUpdate(studentId, { transportRoute: routeId, transportBus: busId }, { new: true });
};

exports.getStudentTransport = async (studentId) => {
    return await Student.findById(studentId).select('transportRoute transportBus').populate('transportRoute').populate('transportBus');
};

exports.getMyTransport = async (userId) => {
    const student = await Student.findOne({ user: userId }).populate('transportRoute').populate('transportBus');
    return student ? { route: student.transportRoute, bus: student.transportBus } : null;
};

exports.getStats = async () => {
    const totalBuses = await TransportBus.countDocuments();
    const totalRoutes = await TransportRoute.countDocuments();
    return { totalBuses, totalRoutes };
};
