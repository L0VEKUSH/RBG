const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { getContentByPage, getAllContent, updateContent } = require('../controllers/cms.controller');

const router = express.Router();

router.get('/content/:page', getContentByPage); // Public route

router.use(protect);
router.get('/content', requirePermission('cms.view'), getAllContent);
router.put('/content/:page', requirePermission('cms.manage'), updateContent);

module.exports = router;
