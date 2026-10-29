const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getSubjects, createSubject, getSubject, updateSubject, deleteSubject, getSubjectsByClass
} = require('../controllers/subject.controller');

const router = express.Router();

router.use(protect);

router.get('/', getSubjects);
router.post('/', requirePermission('subjects.manage'), createSubject);
router.get('/:id', getSubject);
router.put('/:id', requirePermission('subjects.manage'), updateSubject);
router.delete('/:id', requirePermission('subjects.manage'), deleteSubject);
router.get('/class/:classLevel', getSubjectsByClass);

module.exports = router;
