const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { getAllSettings, getSetting, updateSetting, bulkUpdate } = require('../controllers/settings.controller');

const router = express.Router();

router.use(protect);

router.get('/', requirePermission('settings.view'), getAllSettings);
router.get('/:key', requirePermission('settings.view'), getSetting);
router.put('/:key', requirePermission('settings.manage'), updateSetting);
router.post('/bulk', requirePermission('settings.manage'), bulkUpdate);

module.exports = router;
