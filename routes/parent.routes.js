const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getParents, getMyChildren, createParent, getParent, updateParent, getParentChildren 
} = require('../controllers/parent.controller');

const router = express.Router();

router.use(protect);

router.get('/', requireRole('super_admin', 'school_admin', 'admin', 'principal'), requirePermission('students.view', 'users.view'), getParents);
router.get('/my-children', requireRole('parent'), requirePermission('students.view-linked'), getMyChildren);
router.post('/', requirePermission('users.create'), createParent);
router.get('/:id', requireRole('super_admin', 'school_admin', 'admin', 'principal', 'parent'), requirePermission('students.view', 'users.view', 'parents.view-own'), requireOwnership('Parent', 'id'), getParent);
router.put('/:id', requireRole('super_admin', 'school_admin', 'admin', 'principal', 'parent'), requirePermission('users.update', 'parents.update-own'), requireOwnership('Parent', 'id'), updateParent);
router.get('/:id/children', requireRole('super_admin', 'school_admin', 'admin', 'principal', 'parent'), requirePermission('students.view', 'students.view-linked'), requireOwnership('Parent', 'id'), getParentChildren);

module.exports = router;
