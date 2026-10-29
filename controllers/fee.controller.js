const feeService = require('../services/fee.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getFeeStructures = async (req, res, next) => {
    try {
        const structures = await feeService.getFeeStructures();
        res.status(200).json({ success: true, message: 'Fee structures retrieved', data: structures, count: structures.length });
    } catch (error) { next(error); }
};

exports.createFeeStructure = async (req, res, next) => {
    try {
        const structure = await feeService.createFeeStructure(req.body);
        res.status(201).json({ success: true, message: 'Fee structure created', data: structure });
    } catch (error) { next(error); }
};

exports.updateFeeStructure = async (req, res, next) => {
    try {
        const structure = await feeService.updateFeeStructure(req.params.id, req.body);
        res.status(200).json({ success: true, message: 'Fee structure updated', data: structure });
    } catch (error) { next(error); }
};

exports.getStudentFees = async (req, res, next) => {
    try {
        // Assume role checks done by middleware
        const fees = await feeService.getStudentFees(req.params.studentId);
        res.status(200).json({ success: true, message: 'Student fees retrieved', data: fees, count: fees.length });
    } catch (error) { next(error); }
};

exports.assignFee = async (req, res, next) => {
    try {
        const fee = await feeService.assignFee(req.params.studentId, req.body);
        res.status(201).json({ success: true, message: 'Fee assigned', data: fee });
    } catch (error) { next(error); }
};

exports.makePayment = async (req, res, next) => {
    try {
        const payment = await feeService.makePayment(req.body);
        res.status(201).json({ success: true, message: 'Payment recorded', data: payment });
    } catch (error) { next(error); }
};

exports.getReceipt = async (req, res, next) => {
    try {
        const receipt = await feeService.getReceipt(req.params.id);
        res.status(200).json({ success: true, message: 'Receipt retrieved', data: receipt });
    } catch (error) { next(error); }
};

exports.getMyFees = async (req, res, next) => {
    try {
        const fees = await feeService.getStudentFeesByUser(req.user._id);
        res.status(200).json({ success: true, message: 'Fees retrieved', data: fees, count: fees.length });
    } catch (error) { next(error); }
};

exports.getFeeReport = async (req, res, next) => {
    try {
        const report = await feeService.getFeeReport();
        res.status(200).json({ success: true, message: 'Fee report retrieved', data: report });
    } catch (error) { next(error); }
};

exports.getPendingFees = async (req, res, next) => {
    try {
        const pending = await feeService.getPendingFees();
        res.status(200).json({ success: true, message: 'Pending fees retrieved', data: pending, count: pending.length });
    } catch (error) { next(error); }
};

exports.getAllFees = async (req, res, next) => {
    try {
        const result = await feeService.getAllFees(req.query);
        res.status(200).json({ success: true, message: 'All fees retrieved', data: result });
    } catch (error) { next(error); }
};
