const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission } = require('../middleware/authorization.middleware');
const { 
    getLeaves, applyLeave, getMyLeaves, getPendingLeaves, 
    getLeave, updateLeaveStatus
} = require('../controllers/leave.controller');

const router = express.Router();

router.use(protect);

router.get('/', requirePermission('leave.view'), getLeaves);
router.post('/', requirePermission('leave.apply'), applyLeave);
router.get('/my-leaves', requirePermission('leave.apply'), getMyLeaves);
router.get('/pending', requirePermission('leave.approve', 'leave.view'), getPendingLeaves);
router.get('/:id', requirePermission('leave.view', 'leave.apply'), getLeave);
router.put('/:id/status', requirePermission('leave.approve', 'leave.reject'), updateLeaveStatus);

module.exports = router;
