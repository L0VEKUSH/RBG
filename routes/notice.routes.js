const express = require('express');
const router = express.Router();
const {
  createNotice, getAllNotices, getPinnedNotices, getNoticeById,
  updateNotice, deleteNotice, togglePin, getNoticesByType,
} = require('../controllers/notice.controller');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');

// Public routes
router.get('/', getAllNotices);
router.get('/pinned', getPinnedNotices);
router.get('/type/:type', getNoticesByType);
router.get('/:id', getNoticeById);

// Protected routes
router.use(protect);
router.post('/', requirePermission('notices.create'), createNotice);
router.put('/:id', requirePermission('notices.update'), updateNotice);
router.delete('/:id', requirePermission('notices.delete'), deleteNotice);
router.put('/:id/pin', requirePermission('notices.update'), togglePin);

module.exports = router;
