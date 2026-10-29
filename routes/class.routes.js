const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getClasses, createClass, getClass, updateClass, deleteClass, getClassStudents
} = require('../controllers/class.controller');

const router = express.Router();

router.use(protect);

router.get('/', getClasses);
router.post('/', requirePermission('classes.manage'), createClass);
router.get('/:id', getClass);
router.put('/:id', requirePermission('classes.manage'), updateClass);
router.delete('/:id', requirePermission('classes.manage'), deleteClass);
router.get('/:id/students', requirePermission('classes.view', 'classes.view-assigned'), getClassStudents);

module.exports = router;
