const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getBooks, addBook, updateBook, deleteBook, issueBook, returnBook,
    getTransactions, getStudentTransactions, getMyBooks, getOverdueBooks, getStats
} = require('../controllers/library.controller');

const router = express.Router();

router.use(protect);

router.get('/books', getBooks);
router.post('/books', requirePermission('library.manage'), addBook);
router.put('/books/:id', requirePermission('library.manage'), updateBook);
router.delete('/books/:id', requireRole('super_admin', 'school_admin', 'admin'), deleteBook);

router.post('/issue', requirePermission('library.issue'), issueBook);
router.post('/return', requirePermission('library.return'), returnBook);

router.get('/transactions', requirePermission('library.view'), getTransactions);
router.get('/student/:studentId', requirePermission('library.view', 'library.view-linked'), getStudentTransactions);
router.get('/my-books', requirePermission('library.view-own'), getMyBooks);

router.get('/overdue', requirePermission('library.view'), getOverdueBooks);
router.get('/stats', requirePermission('library.view', 'library.report'), getStats);

module.exports = router;
