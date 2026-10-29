const dashboardService = require('../services/dashboard.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getAdminDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getAdminDashboard();
        res.status(200).json({ success: true, message: 'Admin dashboard data', data });
    } catch (error) { next(error); }
};

exports.getPrincipalDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getPrincipalDashboard();
        res.status(200).json({ success: true, message: 'Principal dashboard data', data });
    } catch (error) { next(error); }
};

exports.getTeacherDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getTeacherDashboard(req.user._id);
        res.status(200).json({ success: true, message: 'Teacher dashboard data', data });
    } catch (error) { next(error); }
};

exports.getStudentDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getStudentDashboard(req.user._id);
        if(!data) return next(new ErrorResponse('Student record not found', 404));
        res.status(200).json({ success: true, message: 'Student dashboard data', data });
    } catch (error) { next(error); }
};

exports.getParentDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getParentDashboard(req.user._id);
        res.status(200).json({ success: true, message: 'Parent dashboard data', data });
    } catch (error) { next(error); }
};

exports.getAccountantDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getAccountantDashboard();
        res.status(200).json({ success: true, message: 'Accountant dashboard data', data });
    } catch (error) { next(error); }
};

exports.getLibrarianDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getLibrarianDashboard();
        res.status(200).json({ success: true, message: 'Librarian dashboard data', data });
    } catch (error) { next(error); }
};

exports.getVicePrincipalDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getVicePrincipalDashboard();
        res.status(200).json({ success: true, message: 'Vice Principal dashboard data', data });
    } catch (error) { next(error); }
};

exports.getAcademicCoordinatorDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getAcademicCoordinatorDashboard();
        res.status(200).json({ success: true, message: 'Academic Coordinator dashboard data', data });
    } catch (error) { next(error); }
};

exports.getAdmissionOfficerDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getAdmissionOfficerDashboard();
        res.status(200).json({ success: true, message: 'Admission Officer dashboard data', data });
    } catch (error) { next(error); }
};

exports.getExamCoordinatorDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getExamCoordinatorDashboard();
        res.status(200).json({ success: true, message: 'Exam Coordinator dashboard data', data });
    } catch (error) { next(error); }
};

exports.getDriverDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getDriverDashboard(req.user._id);
        res.status(200).json({ success: true, message: 'Driver dashboard data', data });
    } catch (error) { next(error); }
};

exports.getReceptionistDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getReceptionistDashboard();
        res.status(200).json({ success: true, message: 'Receptionist dashboard data', data });
    } catch (error) { next(error); }
};

exports.getHrDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getHrDashboard();
        res.status(200).json({ success: true, message: 'HR dashboard data', data });
    } catch (error) { next(error); }
};

exports.getStaffDashboard = async (req, res, next) => {
    try {
        const data = await dashboardService.getStaffDashboard(req.user._id);
        res.status(200).json({ success: true, message: 'Staff dashboard data', data });
    } catch (error) { next(error); }
};
