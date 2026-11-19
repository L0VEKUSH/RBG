const libraryService = require('../services/library.service');
const ErrorResponse = require('../utils/errorResponse');

exports.getBooks = async (req, res, next) => {
    try {
        const books = await libraryService.getBooks(req.user);
        res.status(200).json({ success: true, message: 'Books retrieved', data: books, count: books.length });
    } catch (error) { next(error); }
};

exports.addBook = async (req, res, next) => {
    try {
        const book = await libraryService.addBook(req.body, req.user);
        res.status(201).json({ success: true, message: 'Book added', data: book });
    } catch (error) { next(error); }
};

exports.updateBook = async (req, res, next) => {
    try {
        const book = await libraryService.updateBook(req.params.id, req.body, req.user);
        res.status(200).json({ success: true, message: 'Book updated', data: book });
    } catch (error) { next(error); }
};

exports.deleteBook = async (req, res, next) => {
    try {
        await libraryService.deleteBook(req.params.id, req.user);
        res.status(200).json({ success: true, message: 'Book deleted', data: {} });
    } catch (error) { next(error); }
};

exports.issueBook = async (req, res, next) => {
    try {
        const txn = await libraryService.issueBook(req.body.bookId, req.body.studentId, req.body.dueDate, req.user);
        res.status(201).json({ success: true, message: 'Book issued', data: txn });
    } catch (error) { next(error); }
};

exports.returnBook = async (req, res, next) => {
    try {
        const txn = await libraryService.returnBook(req.body.transactionId, req.user);
        res.status(200).json({ success: true, message: 'Book returned', data: txn });
    } catch (error) { next(error); }
};

exports.getTransactions = async (req, res, next) => {
    try {
        const txns = await libraryService.getTransactions(req.user);
        res.status(200).json({ success: true, message: 'Transactions retrieved', data: txns, count: txns.length });
    } catch (error) { next(error); }
};

exports.getStudentTransactions = async (req, res, next) => {
    try {
        const txns = await libraryService.getStudentTransactions(req.params.studentId, req.user);
        res.status(200).json({ success: true, message: 'Student transactions retrieved', data: txns, count: txns.length });
    } catch (error) { next(error); }
};

exports.getMyBooks = async (req, res, next) => {
    try {
        const txns = await libraryService.getMyBooks(req.user);
        res.status(200).json({ success: true, message: 'My books retrieved', data: txns, count: txns.length });
    } catch (error) { next(error); }
};

exports.getOverdueBooks = async (req, res, next) => {
    try {
        const overdue = await libraryService.getOverdueBooks(req.user);
        res.status(200).json({ success: true, message: 'Overdue books retrieved', data: overdue, count: overdue.length });
    } catch (error) { next(error); }
};

exports.getStats = async (req, res, next) => {
    try {
        const stats = await libraryService.getStats(req.user);
        res.status(200).json({ success: true, message: 'Library stats retrieved', data: stats });
    } catch (error) { next(error); }
};
