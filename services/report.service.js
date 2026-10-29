const Attendance = require('../models/Attendance');
const Marks = require('../models/Marks');
const FeePayment = require('../models/Payment');
const Student = require('../models/Student');
const LibraryTransaction = require('../models/LibraryTransaction');

exports.getAttendanceReport = async (filters) => {
    return await Attendance.aggregate([
        { $match: filters },
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
};

exports.getMarksReport = async (filters) => {
    return await Marks.aggregate([
        { $match: filters },
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
        { $group: { _id: '$classLevel', studentCount: { $sum: 1 } } }
    ]);
};

exports.getLibraryReport = async (filters) => {
    return await LibraryTransaction.aggregate([
        { $match: filters },
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
};
