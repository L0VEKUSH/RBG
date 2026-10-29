const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getMyNotifications, getUnreadCount, markAsRead, markAllAsRead, 
    createNotification, deleteNotification
} = require('../controllers/notification.controller');

const router = express.Router();

router.use(protect);

router.get('/', getMyNotifications);
router.get('/unread-count', getUnreadCount);
router.put('/:id/read', markAsRead);
router.put('/read-all', markAllAsRead);
router.post('/', requireRole('super_admin', 'school_admin', 'system'), createNotification);
router.delete('/:id', deleteNotification);

module.exports = router;
