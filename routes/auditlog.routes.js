const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { getAuditLogs } = require('../controllers/auditlog.controller');

const router = express.Router();

router.use(protect);
router.get('/', requireRole('super_admin'), getAuditLogs);

module.exports = router;
