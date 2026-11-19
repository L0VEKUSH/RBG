const reportService = require('../services/report.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getAttendanceReport = async (req, res, next) => {
    try {
        const report = await reportService.getAttendanceReport(req.query, req.user);
        res.status(200).json({ success: true, message: 'Attendance report generated', data: report });
    } catch (error) { next(error); }
};

exports.getMarksReport = async (req, res, next) => {
    try {
        const report = await reportService.getMarksReport(req.query, req.user);
        res.status(200).json({ success: true, message: 'Marks report generated', data: report });
    } catch (error) { next(error); }
};

exports.getFeesReport = async (req, res, next) => {
    try {
        const report = await reportService.getFeesReport(req.query);
        res.status(200).json({ success: true, message: 'Fees report generated', data: report });
    } catch (error) { next(error); }
};

exports.getStudentsReport = async (req, res, next) => {
    try {
        const report = await reportService.getStudentsReport(req.query);
        res.status(200).json({ success: true, message: 'Students report generated', data: report });
    } catch (error) { next(error); }
};

exports.getLibraryReport = async (req, res, next) => {
    try {
        const report = await reportService.getLibraryReport(req.query);
        res.status(200).json({ success: true, message: 'Library report generated', data: report });
    } catch (error) { next(error); }
};
