const express = require('express');
const router = express.Router();
const {
  createNotice, getAllNotices, getPinnedNotices, getNoticeById,
  updateNotice, deleteNotice, togglePin, getNoticesByType,
} = require('../controllers/notice.controller');
const { protect, optionalProtect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireAllPermissions, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');

// Public routes
router.get('/', optionalProtect, getAllNotices);
router.get('/pinned', optionalProtect, getPinnedNotices);
router.get('/type/:type', optionalProtect, getNoticesByType);
router.get('/:id', optionalProtect, getNoticeById);

// Protected routes
router.use(protect);
router.post('/', requirePermission('notices.create'), createNotice);
router.put('/:id', requirePermission('notices.update'), updateNotice);
router.delete('/:id', requirePermission('notices.delete'), deleteNotice);
router.put('/:id/pin', requireAllPermissions('notices.update', 'notices.view-management'), togglePin);

module.exports = router;
