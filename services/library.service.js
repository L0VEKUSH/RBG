const mongoose = require('mongoose');
const LibraryBook = require('../models/LibraryBook');
const LibraryTransaction = require('../models/LibraryTransaction');
const Student = require('../models/Student');
const User = require('../models/User');
const Parent = require('../models/Parent');
const { getStudentAccess } = require('./student-access.service');
const ErrorResponse = require('../utils/errorResponse');
const { getRolePermissions } = require('../config/permissions');

const LIBRARY_STUDENT_SELECT = 'admissionNumber rollNumber class academicYear user';
const LIBRARY_BOOK_CATEGORIES = new Set([
    'Fiction', 'Non-Fiction', 'Science', 'Mathematics', 'History', 'Geography',
    'Literature', 'Reference', 'Textbook', 'Biography', 'Other',
]);
const LIBRARY_BOOK_FIELDS = new Set([
    'title', 'author', 'isbn', 'category', 'publisher', 'publicationYear',
    'totalCopies', 'location', 'description', 'coverImage',
]);

function invalidBookInput(message) {
    throw new ErrorResponse(message, 400);
}

function parseCopyCount(value, fieldName) {
    const normalized = typeof value === 'string' ? value.trim() : value;
    if ((typeof normalized !== 'number' && (typeof normalized !== 'string' || !/^\d+$/.test(normalized))) ||
        !Number.isSafeInteger(Number(normalized)) || Number(normalized) < 1) {
        invalidBookInput(`${fieldName} must be a positive whole number`);
    }
    return Number(normalized);
}

function normalizeBookInput(data, { create = false } = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        invalidBookInput('Book data must be an object');
    }
    if (Object.prototype.hasOwnProperty.call(data, 'availableCopies')) {
        invalidBookInput('availableCopies is managed by library inventory operations');
    }

    const unsupported = Object.keys(data).filter(field => !LIBRARY_BOOK_FIELDS.has(field));
    if (unsupported.length) invalidBookInput(`Unsupported book field: ${unsupported[0]}`);

    const normalized = {};
    for (const field of ['title', 'author', 'isbn', 'publisher', 'location', 'description', 'coverImage']) {
        if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
        const value = data[field];
        if ((field === 'title' || field === 'author') && (typeof value !== 'string' || !value.trim())) {
            invalidBookInput(`${field} is required`);
        }
        if (value !== null && typeof value !== 'string') {
            invalidBookInput(`${field} must be text`);
        }
        normalized[field] = typeof value === 'string' ? value.trim() : value;
    }

    if (create && (!normalized.title || !normalized.author)) {
        invalidBookInput('Title and author are required');
    }

    if (Object.prototype.hasOwnProperty.call(data, 'category')) {
        const category = data.category;
        if (category === '' || category === null) normalized.category = undefined;
        else if (typeof category !== 'string' || !LIBRARY_BOOK_CATEGORIES.has(category)) {
            invalidBookInput('Category is invalid');
        } else normalized.category = category;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'publicationYear')) {
        const year = data.publicationYear;
        if (year === null || year === '') normalized.publicationYear = undefined;
        else {
            const validStringYear = typeof year === 'string' && /^\d+$/.test(year.trim());
            const numericYear = typeof year === 'number' ? year : validStringYear ? Number(year.trim()) : NaN;
            if (!Number.isSafeInteger(numericYear)) invalidBookInput('Publication year must be a whole number');
            normalized.publicationYear = numericYear;
        }
    }

    const hasTotalCopies = Object.prototype.hasOwnProperty.call(data, 'totalCopies');
    if (create && !hasTotalCopies) invalidBookInput('Total copies is required');
    if (create || hasTotalCopies) {
        const copies = data.totalCopies;
        normalized.totalCopies = parseCopyCount(copies, 'Total copies');
    }

    if (!create && Object.keys(normalized).length === 0) invalidBookInput('At least one book field is required');
    return normalized;
}

function assertValidStoredInventory(book) {
    if (!Number.isSafeInteger(book.totalCopies) || book.totalCopies < 1 ||
        !Number.isSafeInteger(book.availableCopies) || book.availableCopies < 0 ||
        book.availableCopies > book.totalCopies) {
        throw new ErrorResponse('Book inventory is inconsistent and requires review', 409);
    }
}

function requireBookId(id) {
    if (!mongoose.isObjectIdOrHexString(id)) throw new ErrorResponse('Library book not found', 404);
}

function requireActor(actor) {
    if (!actor || !actor._id) throw new ErrorResponse('Not authenticated', 401);
    return actor;
}

function hasPermission(actor, permission) {
    if (actor.role === 'super_admin') return true;

    const permissions = new Set(getRolePermissions(actor.role));
    for (const override of Array.isArray(actor.permissions) ? actor.permissions : []) {
        if (typeof override !== 'string') continue;
        if (override.startsWith('-')) permissions.delete(override.slice(1));
        else permissions.add(override);
    }

    return permissions.has('*') || permissions.has(permission);
}

function requirePermission(actor, ...requiredPermissions) {
    requireActor(actor);
    if (!requiredPermissions.some(permission => hasPermission(actor, permission))) {
        throw new ErrorResponse('Library permission denied', 403);
    }
    return actor;
}

function requireRole(actor, ...roles) {
    requireActor(actor);
    if (actor.role === 'super_admin') return actor;

    const allowedRoles = new Set(roles);
    if (allowedRoles.has('admin')) allowedRoles.add('school_admin');
    if (allowedRoles.has('faculty')) {
        allowedRoles.add('teacher');
        allowedRoles.add('class_teacher');
    }
    if (!allowedRoles.has(actor.role)) throw new ErrorResponse('Library role denied', 403);
    return actor;
}

function normalizeId(value) {
    return value && value._id ? value._id : value;
}

function uniqueIds(values) {
    const ids = new Map();
    for (const value of values) {
        const id = normalizeId(value);
        if (id) ids.set(String(id), id);
    }
    return [...ids.values()];
}

async function getParentLinkedStudentIds(actor) {
    const parent = await Parent.findOne({ user: actor._id }).select('children isActive');
    if (parent && parent.isActive === false) {
        throw new ErrorResponse('Parent profile is inactive', 403);
    }

    const childIds = (parent && Array.isArray(parent.children) ? parent.children : []).map(normalizeId);
    const studentFilter = childIds.length
        ? { $or: [{ _id: { $in: childIds } }, { parentUser: actor._id }] }
        : { parentUser: actor._id };
    const linkedStudents = await Student.find(studentFilter).select('_id');
    return uniqueIds(linkedStudents.map(student => student._id));
}

async function getActorStudentScope(actor) {
    if (actor.role === 'student') {
        const student = await Student.findOne({ user: actor._id }).select('_id');
        if (!student) throw new ErrorResponse('Student profile not found', 404);
        return [student._id];
    }

    if (actor.role === 'parent') return getParentLinkedStudentIds(actor);

    if (['teacher', 'class_teacher', 'faculty'].includes(actor.role)) {
        const access = await getStudentAccess(actor);
        const assignedStudents = await Student.find(access.filter).select('_id');
        return uniqueIds(assignedStudents.map(student => student._id));
    }

    return null;
}

async function scopedTransactionFilter(actor, baseFilter = {}) {
    const studentIds = await getActorStudentScope(actor);
    if (studentIds === null) return baseFilter;
    return { ...baseFilter, student: { $in: studentIds } };
}

function populateLibraryStudentSummary(query) {
    return query.populate({
        path: 'student',
        select: LIBRARY_STUDENT_SELECT,
        populate: { path: 'user', select: 'name' },
    });
}

exports.getBooks = async (actor) => {
    requireActor(actor);
    return await LibraryBook.find({ isActive: { $ne: false } });
};

exports.addBook = async (data, actor) => {
    requirePermission(actor, 'library.manage');
    const bookData = normalizeBookInput(data, { create: true });
    bookData.availableCopies = bookData.totalCopies;
    return await LibraryBook.create(bookData);
};

exports.updateBook = async (id, data, actor) => {
    requirePermission(actor, 'library.manage');
    requireBookId(id);
    const updates = normalizeBookInput(data);

    if (Object.prototype.hasOwnProperty.call(updates, 'totalCopies')) {
        const session = await mongoose.startSession();
        let updated = null;

        try {
            await session.withTransaction(async () => {
                const current = await LibraryBook.findById(id)
                    .session(session)
                    .select('_id totalCopies availableCopies');
                if (!current) throw new ErrorResponse('Library book not found', 404);
                assertValidStoredInventory(current);

                const activeLoanCount = await LibraryTransaction.countDocuments({
                    book: id,
                    status: { $in: ['Issued', 'Overdue'] },
                }).session(session);

                const unavailableCopies = current.totalCopies - current.availableCopies;
                if (unavailableCopies !== activeLoanCount) {
                    throw new ErrorResponse('Book inventory and active loan records disagree; manual review is required', 409);
                }
                if (updates.totalCopies < activeLoanCount) {
                    throw new ErrorResponse('Total copies cannot be lower than active loans', 409);
                }

                updates.availableCopies = updates.totalCopies - activeLoanCount;
                updated = await LibraryBook.findOneAndUpdate(
                    { _id: id, totalCopies: current.totalCopies, availableCopies: current.availableCopies },
                    { $set: updates },
                    { new: true, runValidators: true, session }
                );
                if (!updated) throw new ErrorResponse('Book inventory changed; refresh and retry', 409);
            });

            return updated;
        } finally {
            await session.endSession();
        }
    }

    const updated = await LibraryBook.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true });
    if (!updated) throw new ErrorResponse('Library book not found', 404);
    return updated;
};

exports.deleteBook = async (id, actor) => {
    requireRole(actor, 'super_admin', 'school_admin', 'admin');
    requireBookId(id);
    const session = await mongoose.startSession();
    let result = null;

    try {
        await session.withTransaction(async () => {
            const book = await LibraryBook.findById(id).session(session).select('_id');
            if (!book) throw new ErrorResponse('Library book not found', 404);

            const activeLoan = await LibraryTransaction.exists({
                book: id,
                status: { $in: ['Issued', 'Overdue'] },
            }).session(session);
            if (activeLoan) throw new ErrorResponse('Cannot delete a book with active loans', 409);

            const hasHistory = await LibraryTransaction.exists({ book: id }).session(session);
            if (hasHistory) {
                // Preserve transaction references and hide the title from the active catalog.
                result = await LibraryBook.findOneAndUpdate(
                    { _id: id },
                    { $set: { isActive: false } },
                    { new: true, runValidators: true, session }
                );
            } else {
                result = await LibraryBook.findOneAndDelete({ _id: id }, { session });
            }

            if (!result) throw new ErrorResponse('Library book not found', 404);
        });
        return result;
    } finally {
        await session.endSession();
    }
};

exports.issueBook = async (bookId, studentId, dueDate, actor) => {
    requirePermission(actor, 'library.issue');
    if (!mongoose.isObjectIdOrHexString(bookId) || !mongoose.isObjectIdOrHexString(studentId)) {
        throw new ErrorResponse('Valid book and student IDs are required', 400);
    }

    const issuedBy = actor && actor._id;
    if (!mongoose.isObjectIdOrHexString(issuedBy)) {
        throw new ErrorResponse('Authenticated issuer is required', 401);
    }

    const parsedDueDate = new Date(dueDate);
    if (!dueDate || !Number.isFinite(parsedDueDate.getTime()) || parsedDueDate <= new Date()) {
        throw new ErrorResponse('A valid future due date is required', 400);
    }

    const session = await mongoose.startSession();
    let issuedTransaction = null;

    try {
        await session.withTransaction(async () => {
            const student = await Student.findById(studentId)
                .session(session)
                .select('_id user isActive tcIssued');
            if (!student) throw new ErrorResponse('Student borrower not found', 404);
            if (student.isActive !== true || student.tcIssued === true) {
                throw new ErrorResponse('Student borrower is not eligible to borrow', 409);
            }

            const studentAccount = await User.findById(student.user)
                .session(session)
                .select('_id role isActive');
            if (!studentAccount) throw new ErrorResponse('Student account not found', 404);
            if (studentAccount.role !== 'student' || studentAccount.isActive !== true) {
                throw new ErrorResponse('Student account is not eligible to borrow', 409);
            }

            const book = await LibraryBook.findById(bookId)
                .session(session)
                .select('_id isActive totalCopies availableCopies');
            if (!book) throw new ErrorResponse('Library book not found', 404);
            assertValidStoredInventory(book);
            if (book.isActive !== true) throw new ErrorResponse('Library book is inactive', 409);
            if (book.availableCopies <= 0) {
                throw new ErrorResponse('No copies are currently available', 409);
            }

            const inventoryUpdate = await LibraryBook.updateOne(
                {
                    _id: book._id,
                    isActive: true,
                    totalCopies: book.totalCopies,
                    availableCopies: { $gt: 0, $eq: book.availableCopies },
                },
                { $inc: { availableCopies: -1 } },
                { session }
            );
            if (inventoryUpdate.matchedCount !== 1) {
                throw new ErrorResponse('No copies are currently available', 409);
            }

            const [transaction] = await LibraryTransaction.create([{
                book: book._id,
                student: student._id,
                issuedBy,
                issueDate: new Date(),
                dueDate: parsedDueDate,
                status: 'Issued'
            }], { session });

            issuedTransaction = transaction;
        });

        return issuedTransaction;
    } finally {
        await session.endSession();
    }
};

exports.returnBook = async (transactionId, actor) => {
    requirePermission(actor, 'library.return');
    const session = await mongoose.startSession();
    let returnedTransaction = null;

    try {
        await session.withTransaction(async () => {
            const transaction = await LibraryTransaction.findOneAndUpdate(
                { _id: transactionId, status: 'Issued' },
                { $set: { status: 'Returned', returnDate: new Date() } },
                { new: true, session }
            );

            if (!transaction) {
                throw new ErrorResponse('Issued library transaction not found', 404);
            }

            const book = await LibraryBook.findById(transaction.book)
                .session(session)
                .select('_id totalCopies availableCopies');
            if (!book) throw new ErrorResponse('Library book not found', 404);
            assertValidStoredInventory(book);
            if (book.availableCopies >= book.totalCopies) {
                throw new ErrorResponse('Cannot return this loan because inventory is already at capacity', 409);
            }

            const bookUpdate = await LibraryBook.updateOne(
                {
                    _id: book._id,
                    totalCopies: book.totalCopies,
                    availableCopies: { $eq: book.availableCopies, $lt: book.totalCopies },
                },
                { $inc: { availableCopies: 1 } },
                { session }
            );

            if (bookUpdate.matchedCount !== 1) {
                throw new ErrorResponse('Book inventory changed during return; retry and review the record', 409);
            }

            returnedTransaction = transaction;
        });

        return returnedTransaction;
    } finally {
        await session.endSession();
    }
};

exports.getTransactions = async (actor) => {
    requirePermission(actor, 'library.view');
    const filter = await scopedTransactionFilter(actor);
    const transactions = LibraryTransaction.find(filter).populate('book');
    return await populateLibraryStudentSummary(transactions);
};

exports.getStudentTransactions = async (studentId, actor) => {
    requirePermission(actor, 'library.view', 'library.view-linked');
    if (!mongoose.isObjectIdOrHexString(studentId)) throw new ErrorResponse('Student not found', 404);

    const studentScope = await getActorStudentScope(actor);
    if (studentScope !== null) {
        if (!studentScope.some(id => String(id) === String(studentId))) {
            throw new ErrorResponse('Student not found', 404);
        }
    } else if (!hasPermission(actor, 'library.view')) {
        throw new ErrorResponse('Library permission denied', 403);
    }

    return await LibraryTransaction.find({ student: studentId }).populate('book');
};

exports.getMyBooks = async (actor) => {
    requirePermission(actor, 'library.view-own');
    if (actor.role !== 'student') throw new ErrorResponse('Library self-access is restricted to students', 403);
    const student = await Student.findOne({ user: actor._id }).select('_id');
    if (!student) throw new ErrorResponse('Student profile not found', 404);
    return await LibraryTransaction.find({ student: student._id }).populate('book');
};

exports.getOverdueBooks = async (actor) => {
    requirePermission(actor, 'library.view');
    const filter = await scopedTransactionFilter(actor, { status: 'Issued', dueDate: { $lt: new Date() } });
    const transactions = LibraryTransaction.find(filter).populate('book');
    return await populateLibraryStudentSummary(transactions);
};

exports.getStats = async (actor) => {
    requirePermission(actor, 'library.view', 'library.report');
    const totalBooks = await LibraryBook.countDocuments({ isActive: { $ne: false } });
    const issued = await LibraryTransaction.countDocuments({ status: 'Issued' });
    return { totalBooks, issuedBooks: issued };
};
