const LibraryBook = require('../models/LibraryBook');
const LibraryTransaction = require('../models/LibraryTransaction');
const Student = require('../models/Student');

exports.getBooks = async () => {
    return await LibraryBook.find();
};

exports.addBook = async (data) => {
    return await LibraryBook.create(data);
};

exports.updateBook = async (id, data) => {
    return await LibraryBook.findByIdAndUpdate(id, data, { new: true });
};

exports.deleteBook = async (id) => {
    return await LibraryBook.findByIdAndDelete(id);
};

exports.issueBook = async (bookId, studentId, dueDate) => {
    const transaction = await LibraryTransaction.create({
        book: bookId,
        student: studentId,
        issueDate: new Date(),
        dueDate,
        status: 'issued'
    });
    await LibraryBook.findByIdAndUpdate(bookId, { $inc: { availableCopies: -1 } });
    return transaction;
};

exports.returnBook = async (transactionId) => {
    const transaction = await LibraryTransaction.findByIdAndUpdate(transactionId, { status: 'returned', returnDate: new Date() }, { new: true });
    if(transaction) {
        await LibraryBook.findByIdAndUpdate(transaction.book, { $inc: { availableCopies: 1 } });
    }
    return transaction;
};

exports.getTransactions = async () => {
    return await LibraryTransaction.find().populate('book').populate('student');
};

exports.getStudentTransactions = async (studentId) => {
    return await LibraryTransaction.find({ student: studentId }).populate('book');
};

exports.getMyBooks = async (userId) => {
    const student = await Student.findOne({ user: userId });
    if (!student) return [];
    return await LibraryTransaction.find({ student: student._id }).populate('book');
};

exports.getOverdueBooks = async () => {
    return await LibraryTransaction.find({ status: 'issued', dueDate: { $lt: new Date() } }).populate('book').populate('student');
};

exports.getStats = async () => {
    const totalBooks = await LibraryBook.countDocuments();
    const issued = await LibraryTransaction.countDocuments({ status: 'issued' });
    return { totalBooks, issuedBooks: issued };
};
