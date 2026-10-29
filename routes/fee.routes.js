const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getFeeStructures, createFeeStructure, updateFeeStructure, getStudentFees,
    assignFee, makePayment, getReceipt, getMyFees, getFeeReport, getPendingFees, getAllFees
} = require('../controllers/fee.controller');

const router = express.Router();

router.use(protect);

router.get('/', requirePermission('fees.view'), getAllFees);

router.get('/structures', requirePermission('fees.view'), getFeeStructures);
router.post('/structures', requirePermission('fees.create'), createFeeStructure);
router.put('/structures/:id', requirePermission('fees.collect'), updateFeeStructure);
router.get('/student/:studentId', requirePermission('fees.view', 'fees.view-linked'), requireOwnership('Student', 'studentId'), getStudentFees);
router.post('/student/:studentId/assign', requirePermission('fees.create'), assignFee);
router.post('/payment', requirePermission('fees.collect'), makePayment);
router.get('/payment/:id/receipt', requirePermission('fees.view', 'fees.view-own', 'fees.view-linked', 'fees.receipt'), getReceipt);
router.get('/my-fees', requirePermission('fees.view-own'), getMyFees);
router.get('/report', requirePermission('fees.report'), getFeeReport);
router.get('/pending', requirePermission('fees.report'), getPendingFees);

module.exports = router;
