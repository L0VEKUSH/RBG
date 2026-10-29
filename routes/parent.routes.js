const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getParents, getMyChildren, createParent, getParent, updateParent, getParentChildren 
} = require('../controllers/parent.controller');

const router = express.Router();

router.use(protect);

router.get('/', requirePermission('students.view', 'students.view-basic'), getParents);
router.get('/my-children', requirePermission('students.view-linked'), getMyChildren);
router.post('/', requirePermission('users.create'), createParent);
router.get('/:id', requirePermission('students.view', 'students.view-basic', 'profile.view-own'), requireOwnership('Parent', 'id'), getParent);
router.put('/:id', requirePermission('users.update'), updateParent);
router.get('/:id/children', requirePermission('students.view', 'students.view-basic', 'students.view-linked'), requireOwnership('Parent', 'id'), getParentChildren);

module.exports = router;
