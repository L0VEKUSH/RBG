'use strict';

const mongoose = require('mongoose');
const FeeStructure = require('../models/FeeStructure');
const StudentFee = require('../models/StudentFee');
const Payment = require('../models/Payment');
const Student = require('../models/Student');
const APIFeatures = require('../utils/apiFeatures');
const ErrorResponse = require('../utils/errorResponse');
const { ensureIndexReady } = require('../utils/mongoose-index-policy');
const { getRolePermissions } = require('../config/permissions');
const { assertStudentAccess } = require('./student-access.service');

const PAYMENT_METHODS = new Set(['Cash', 'Cheque', 'Online', 'BankTransfer']);
const ASSIGNMENT_FIELDS = new Set([
    'feeStructure', 'class', 'academicYear', 'totalAmount', 'discount', 'scholarship', 'fine', 'dueDate', 'remarks'
]);
const PAYMENT_FIELDS = new Set(['studentFee', 'amount', 'method', 'remarks', 'idempotencyKey']);
const STUDENT_SUMMARY_POPULATION = {
    path: 'student',
    select: 'admissionNumber class rollNumber academicYear user',
    populate: { path: 'user', select: 'name' }
};
let paymentIdempotencyIndexPromise;

function actorId(actor) {
    return actor && (actor._id || actor.id);
}

function assertPermission(actor, ...permissions) {
    if (!actorId(actor)) throw new ErrorResponse('Not authenticated', 401);
    const effective = new Set(getRolePermissions(actor.role));
    for (const permission of actor.permissions || []) {
        if (typeof permission !== 'string') continue;
        if (permission.startsWith('-')) effective.delete(permission.slice(1));
        else effective.add(permission);
    }
    if (!permissions.some(permission => effective.has(permission) || effective.has('*'))) {
        throw new ErrorResponse('Permission denied', 403);
    }
}

function rejectUnknownFields(data, allowedFields) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new ErrorResponse('A valid request object is required', 400);
    }
    const unknown = Object.keys(data).filter(key => !allowedFields.has(key));
    if (unknown.length) throw new ErrorResponse(`Unsupported field: ${unknown[0]}`, 400);
}

function moneyToMinorUnits(value, name, { positive = false } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value <= 0)) {
        throw new ErrorResponse(`${name} must be ${positive ? 'a positive finite amount' : 'a finite nonnegative amount'}`, 400);
    }
    const minorUnits = Math.round(value * 100);
    if (Math.abs(value - minorUnits / 100) > 1e-8) {
        throw new ErrorResponse(`${name} may have at most two decimal places`, 400);
    }
    return minorUnits;
}

function fromMinorUnits(value) {
    return value / 100;
}

function addPopulate(query, population) {
    return query.populate(population);
}

function studentFeeListQuery(filter, { includePayments = false } = {}) {
    const fields = '_id student feeStructure class academicYear totalAmount paidAmount discount scholarship fine status dueDate';
    return addPopulate(
        addPopulate(StudentFee.find(filter).select(includePayments ? `${fields} payments remarks` : fields), STUDENT_SUMMARY_POPULATION),
        { path: 'feeStructure', select: 'name class academicYear components' }
    );
}

function validateFeeLedgerRow(fee) {
    const total = moneyToMinorUnits(fee.totalAmount, 'Stored totalAmount', { positive: true });
    const paid = moneyToMinorUnits(fee.paidAmount == null ? 0 : fee.paidAmount, 'Stored paidAmount');
    const discount = moneyToMinorUnits(fee.discount == null ? 0 : fee.discount, 'Stored discount');
    const scholarship = moneyToMinorUnits(fee.scholarship == null ? 0 : fee.scholarship, 'Stored scholarship');
    const fine = moneyToMinorUnits(fee.fine == null ? 0 : fee.fine, 'Stored fine');
    const remaining = total + fine - paid - discount - scholarship;
    if (remaining < 0) throw new ErrorResponse('Fee ledger is inconsistent; payment was not recorded', 409);
    return { total, paid, discount, scholarship, fine, remaining };
}

function paymentMatchesRequest(payment, request, actor) {
    return payment &&
        String(payment.studentFee) === String(request.studentFee) &&
        String(payment.receivedBy) === String(actorId(actor)) &&
        Math.round(Number(payment.amount) * 100) === Math.round(request.amount * 100) &&
        payment.method === request.method &&
        (payment.remarks || '') === (request.remarks || '');
}

function isTransactionUnsupported(error) {
    return error && (
        error.code === 20 ||
        error.codeName === 'IllegalOperation' ||
        /transaction numbers are only allowed|transactions are not supported|does not support transactions|replica set/i.test(error.message || '')
    );
}

function addValueOrMissingFilter(filter, field, value) {
    filter[field] = value === undefined ? { $exists: false } : value;
}

async function findPaymentByIdempotencyKey(idempotencyKey) {
    return Payment.findOne({ idempotencyKey });
}

async function ensurePaymentIdempotencyIndex() {
    if (!paymentIdempotencyIndexPromise) {
        paymentIdempotencyIndexPromise = ensureIndexReady(Payment,
            { idempotencyKey: 1 },
            { unique: true, sparse: true }
        ).catch(error => {
            paymentIdempotencyIndexPromise = null;
            throw new ErrorResponse('Payment idempotency index is unavailable; collection was not attempted', 503);
        });
    }
    return paymentIdempotencyIndexPromise;
}

exports.getFeeStructures = async (actor) => {
    assertPermission(actor, 'fees.view');
    return FeeStructure.find();
};

exports.createFeeStructure = async (data, actor) => {
    assertPermission(actor, 'fees.create');
    return FeeStructure.create(data);
};

exports.updateFeeStructure = async (id, data, actor) => {
    assertPermission(actor, 'fees.collect');
    const structure = await FeeStructure.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!structure) throw new ErrorResponse('Fee structure not found', 404);
    return structure;
};

exports.getStudentFees = async (studentId, user) => {
    assertPermission(user, 'fees.view', 'fees.view-own', 'fees.view-linked');
    await assertStudentAccess(user, studentId);
    return studentFeeListQuery({ student: studentId }, { includePayments: true });
};

exports.assignFee = async (studentId, data, actor) => {
    assertPermission(actor, 'fees.create');
    rejectUnknownFields(data, ASSIGNMENT_FIELDS);
    if (!mongoose.isValidObjectId(studentId)) throw new ErrorResponse('Student not found', 404);

    const student = await Student.findOne({ _id: studentId, isActive: true }).select('_id class academicYear');
    if (!student) throw new ErrorResponse('Active student not found', 404);
    if (!student.class || !student.academicYear) {
        throw new ErrorResponse('Student class and academic year are required before fee assignment', 400);
    }
    if (data.class !== undefined && data.class !== student.class) {
        throw new ErrorResponse('Fee class must match the student class', 400);
    }
    if (data.academicYear !== undefined && data.academicYear !== student.academicYear) {
        throw new ErrorResponse('Fee academic year must match the student academic year', 400);
    }

    let totalMinor;
    let feeStructureId;
    if (data.feeStructure !== undefined && data.feeStructure !== null && data.feeStructure !== '') {
        if (!mongoose.isValidObjectId(data.feeStructure)) throw new ErrorResponse('Fee structure not found', 404);
        const structure = await FeeStructure.findOne({
            _id: data.feeStructure,
            class: student.class,
            academicYear: student.academicYear,
            isActive: true
        });
        if (!structure) throw new ErrorResponse('Active fee structure for this student class and year was not found', 404);
        const components = structure.components || [];
        totalMinor = components.reduce((sum, component) => sum + moneyToMinorUnits(component.amount, 'Fee component amount'), 0);
        if (!totalMinor) throw new ErrorResponse('Fee structure must have a positive total amount', 400);
        if (data.totalAmount !== undefined && moneyToMinorUnits(data.totalAmount, 'totalAmount', { positive: true }) !== totalMinor) {
            throw new ErrorResponse('totalAmount must match the selected fee structure', 400);
        }
        feeStructureId = structure._id;
    } else {
        totalMinor = moneyToMinorUnits(data.totalAmount, 'totalAmount', { positive: true });
    }

    const discountMinor = moneyToMinorUnits(data.discount === undefined ? 0 : data.discount, 'discount');
    const scholarshipMinor = moneyToMinorUnits(data.scholarship === undefined ? 0 : data.scholarship, 'scholarship');
    const fineMinor = moneyToMinorUnits(data.fine === undefined ? 0 : data.fine, 'fine');
    if (totalMinor + fineMinor - discountMinor - scholarshipMinor <= 0) {
        throw new ErrorResponse('Discount and scholarship must leave a positive balance due', 400);
    }

    let dueDate;
    if (data.dueDate !== undefined && data.dueDate !== null && data.dueDate !== '') {
        dueDate = new Date(data.dueDate);
        if (!Number.isFinite(dueDate.getTime())) throw new ErrorResponse('dueDate must be a valid date', 400);
    }
    if (data.remarks !== undefined && (typeof data.remarks !== 'string' || data.remarks.length > 500)) {
        throw new ErrorResponse('remarks must be a string of at most 500 characters', 400);
    }

    return StudentFee.create({
        student: student._id,
        ...(feeStructureId && { feeStructure: feeStructureId }),
        class: student.class,
        academicYear: student.academicYear,
        totalAmount: fromMinorUnits(totalMinor),
        paidAmount: 0,
        discount: fromMinorUnits(discountMinor),
        scholarship: fromMinorUnits(scholarshipMinor),
        fine: fromMinorUnits(fineMinor),
        status: 'Pending',
        ...(dueDate && { dueDate }),
        ...(data.remarks !== undefined && { remarks: data.remarks.trim() }),
        payments: []
    });
};

exports.makePayment = async (data, actor) => {
    assertPermission(actor, 'fees.collect');
    rejectUnknownFields(data, PAYMENT_FIELDS);
    if (!mongoose.isValidObjectId(data.studentFee)) throw new ErrorResponse('Student fee record not found', 404);
    const amountMinor = moneyToMinorUnits(data.amount, 'amount', { positive: true });
    if (!PAYMENT_METHODS.has(data.method)) throw new ErrorResponse('Invalid payment method', 400);
    if (data.remarks !== undefined && (typeof data.remarks !== 'string' || data.remarks.length > 500)) {
        throw new ErrorResponse('remarks must be a string of at most 500 characters', 400);
    }
    if (typeof data.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(data.idempotencyKey)) {
        throw new ErrorResponse('A valid idempotencyKey is required', 400);
    }

    const request = {
        studentFee: String(data.studentFee),
        amount: fromMinorUnits(amountMinor),
        method: data.method,
        remarks: data.remarks === undefined ? '' : data.remarks.trim(),
        idempotencyKey: data.idempotencyKey
    };
    let session;
    try {
        await ensurePaymentIdempotencyIndex();
        session = await mongoose.startSession();
        return await session.withTransaction(async () => {
            const prior = await Payment.findOne({ idempotencyKey: request.idempotencyKey }).session(session);
            if (prior) {
                if (!paymentMatchesRequest(prior, request, actor)) {
                    throw new ErrorResponse('Idempotency key was already used for a different payment', 409);
                }
                return prior;
            }

            const fee = await StudentFee.findById(request.studentFee).session(session).lean();
            if (!fee) throw new ErrorResponse('Student fee record not found', 404);
            const ledger = validateFeeLedgerRow(fee);
            if (!['Pending', 'Partial', 'Overdue'].includes(fee.status)) {
                throw new ErrorResponse('This fee record is not open for payment', 409);
            }
            if (ledger.remaining <= 0) throw new ErrorResponse('Fee record has no outstanding balance', 409);
            if (amountMinor > ledger.remaining) throw new ErrorResponse('Payment exceeds the outstanding balance', 400);

            const paidAfter = ledger.paid + amountMinor;
            const remainingAfter = ledger.remaining - amountMinor;
            const paymentDate = new Date();
            const [payment] = await Payment.create([{
                studentFee: fee._id,
                student: fee.student,
                amount: request.amount,
                method: request.method,
                receivedBy: actorId(actor),
                remarks: request.remarks,
                academicYear: fee.academicYear,
                idempotencyKey: request.idempotencyKey,
                date: paymentDate
            }], { session });

            const filter = {
                _id: fee._id,
                totalAmount: fee.totalAmount,
                paidAmount: fee.paidAmount === undefined ? { $exists: false } : fee.paidAmount,
                status: fee.status
            };
            addValueOrMissingFilter(filter, 'discount', fee.discount);
            addValueOrMissingFilter(filter, 'scholarship', fee.scholarship);
            addValueOrMissingFilter(filter, 'fine', fee.fine);

            const update = await StudentFee.updateOne(filter, {
                $set: {
                    paidAmount: fromMinorUnits(paidAfter),
                    status: remainingAfter === 0 ? 'Paid' : 'Partial'
                },
                $push: {
                    payments: {
                        amount: request.amount,
                        date: paymentDate,
                        method: request.method,
                        receiptNumber: payment.receiptNumber,
                        receivedBy: actorId(actor),
                        remarks: request.remarks
                    }
                }
            }, { session, runValidators: true });
            if (update.matchedCount !== 1) {
                throw new ErrorResponse('Fee ledger changed during collection; retry with the same idempotency key', 409);
            }
            return payment;
        });
    } catch (error) {
        if (error && error.code === 11000) {
            const existing = await findPaymentByIdempotencyKey(request.idempotencyKey);
            if (existing && paymentMatchesRequest(existing, request, actor)) return existing;
            if (existing) throw new ErrorResponse('Idempotency key was already used for a different payment', 409);
        }
        if (isTransactionUnsupported(error)) {
            throw new ErrorResponse('Fee collection requires MongoDB transaction support; no payment was recorded', 503);
        }
        throw error;
    } finally {
        if (session) await session.endSession();
    }
};

exports.getReceipt = async (paymentId, user) => {
    assertPermission(user, 'fees.view', 'fees.view-own', 'fees.view-linked', 'fees.receipt');
    if (!mongoose.isValidObjectId(paymentId)) throw new ErrorResponse('Receipt not found', 404);
    const payment = await Payment.findById(paymentId)
        .populate({
            path: 'student',
            select: 'admissionNumber class rollNumber academicYear user',
            populate: { path: 'user', select: 'name' }
        })
        .populate({
            path: 'studentFee',
            select: 'class academicYear totalAmount paidAmount discount scholarship fine status dueDate feeStructure',
            populate: { path: 'feeStructure', select: 'name class academicYear' }
        });
    if (!payment) throw new ErrorResponse('Receipt not found', 404);
    const studentId = payment.student && payment.student._id ? payment.student._id : payment.student;
    await assertStudentAccess(user, studentId);
    return payment;
};

exports.getStudentFeesByUser = async (user) => {
    assertPermission(user, 'fees.view-own');
    const student = await Student.findOne({ user: actorId(user) }).select('_id');
    if (!student) return [];
    return studentFeeListQuery({ student: student._id }, { includePayments: true });
};

exports.getFeeReport = async (actor) => {
    assertPermission(actor, 'fees.report');
    return StudentFee.aggregate([
        { $group: { _id: '$status', totalAmount: { $sum: '$totalAmount' }, collected: { $sum: '$paidAmount' }, count: { $sum: 1 } } }
    ]);
};

exports.getPendingFees = async (actor) => {
    assertPermission(actor, 'fees.report');
    return studentFeeListQuery({ status: { $in: ['Pending', 'Partial', 'Overdue'] } });
};

exports.getAllFees = async (queryString, actor) => {
    assertPermission(actor, 'fees.view');
    const allowedQuery = {};
    for (const key of ['page', 'limit', 'sort', 'status', 'academicYear', 'class', 'keyword']) {
        if (queryString && queryString[key] !== undefined) allowedQuery[key] = queryString[key];
    }
    const baseQuery = studentFeeListQuery({});
    const features = new APIFeatures(baseQuery, allowedQuery)
        .search(['status'])
        .filter()
        .sort()
        .limitFields()
        .paginate();
    const fees = await features.query;
    const total = await StudentFee.countDocuments();
    return { fees, total, page: features.page, limit: features.limit };
};
