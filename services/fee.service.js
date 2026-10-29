const FeeStructure = require('../models/FeeStructure');
const StudentFee = require('../models/StudentFee');
const Payment = require('../models/Payment');
const Student = require('../models/Student');
const APIFeatures = require('../utils/apiFeatures');

exports.getFeeStructures = async () => {
    return await FeeStructure.find();
};

exports.createFeeStructure = async (data) => {
    return await FeeStructure.create(data);
};

exports.updateFeeStructure = async (id, data) => {
    return await FeeStructure.findByIdAndUpdate(id, data, { new: true });
};

exports.getStudentFees = async (studentId) => {
    return await StudentFee.find({ student: studentId }).populate('feeStructure');
};

exports.assignFee = async (studentId, data) => {
    return await StudentFee.create({ student: studentId, ...data });
};

exports.makePayment = async (data) => {
    // data contains studentFee, amount, method, receivedBy, etc.
    const studentFee = await StudentFee.findById(data.studentFee);
    if (!studentFee) throw new Error('Student fee record not found');
    
    const payment = await Payment.create({
        studentFee: studentFee._id,
        student: studentFee.student,
        amount: data.amount,
        method: data.method,
        receivedBy: data.receivedBy,
        remarks: data.remarks
    });

    studentFee.paidAmount = (studentFee.paidAmount || 0) + data.amount;
    if (studentFee.paidAmount >= studentFee.totalAmount) {
        studentFee.status = 'Paid';
    } else if (studentFee.paidAmount > 0) {
        studentFee.status = 'Partial';
    }
    
    studentFee.payments.push({
        amount: data.amount,
        date: payment.date,
        method: payment.method,
        receiptNumber: payment.receiptNumber,
        receivedBy: payment.receivedBy
    });
    
    await studentFee.save();
    return payment;
};

exports.getReceipt = async (paymentId) => {
    return await Payment.findById(paymentId).populate('student').populate('studentFee');
};

exports.getStudentFeesByUser = async (userId) => {
    const student = await Student.findOne({ user: userId });
    if (!student) return [];
    return await StudentFee.find({ student: student._id }).populate('feeStructure');
};

exports.getFeeReport = async () => {
    return await StudentFee.aggregate([
        { $group: { _id: '$status', totalAmount: { $sum: '$totalAmount' }, collected: { $sum: '$paidAmount' }, count: { $sum: 1 } } }
    ]);
};

exports.getPendingFees = async () => {
    return await StudentFee.find({ status: { $in: ['Pending', 'Partial', 'Overdue'] } }).populate('student');
};

exports.getAllFees = async (queryString) => {
    const baseQuery = StudentFee.find().populate('student').populate('feeStructure');
    const features = new APIFeatures(baseQuery, queryString)
        .search(['status'])
        .filter()
        .sort()
        .paginate();
    
    const fees = await features.query;
    const total = await StudentFee.countDocuments();
    return { fees, total, page: features.page, limit: features.limit };
};
