const attendanceService = require('./attendance.service');
const Marks = require('../models/Marks');
const FeePayment = require('../models/Payment');
const Student = require('../models/Student');
const LibraryTransaction = require('../models/LibraryTransaction');
const ErrorResponse = require('../utils/errorResponse');

const MARKS_REPORT_ROLES = new Set(['super_admin', 'school_admin', 'principal']);

exports.getAttendanceReport = async (filters, user) => {
    return attendanceService.getAttendanceReport(filters, user);
};

exports.getMarksReport = async (filters, user) => {
    if (!user || !MARKS_REPORT_ROLES.has(String(user.role || '').toLowerCase())) {
        throw new ErrorResponse('Not authorized to access marks reports', 403);
    }
    const safeFilters = filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : {};
    return await Marks.aggregate([
        { $match: safeFilters },
        { $group: { _id: '$examType', avgPercentage: { $avg: '$percentage' }, passCount: { $sum: { $cond: [{ $eq: ['$result', 'Pass'] }, 1, 0] } }, failCount: { $sum: { $cond: [{ $eq: ['$result', 'Fail'] }, 1, 0] } } } }
    ]);
};

exports.getFeesReport = async (filters) => {
    return await FeePayment.aggregate([
        { $match: filters },
        { $group: { _id: '$status', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);
};

exports.getStudentsReport = async (filters) => {
    return await Student.aggregate([
        { $match: filters },
        { $group: { _id: '$class', studentCount: { $sum: 1 } } }
    ]);
};

exports.getLibraryReport = async (filters) => {
    return await LibraryTransaction.aggregate([
        { $match: filters },
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
};
