const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getHomework, createHomework, getMyHomework, getClassHomework, 
    getHomeworkById, updateHomework, deleteHomework, submitHomework, reviewSubmission
} = require('../controllers/homework.controller');

const router = express.Router();

router.use(protect);

router.get('/', requirePermission('homework.view'), getHomework);
router.post('/', requirePermission('homework.create'), createHomework);
router.get('/my-homework', requirePermission('homework.view', 'homework.view-own'), getMyHomework);
router.get('/class/:class', requirePermission('homework.view', 'homework.view-assigned', 'homework.view-linked'), requireClassAccess('class'), getClassHomework);
router.get('/:id', requirePermission('homework.view', 'homework.view-own', 'homework.view-linked', 'homework.view-assigned'), getHomeworkById);
router.put('/:id', requirePermission('homework.update-own'), updateHomework);
router.delete('/:id', requirePermission('homework.update-own'), deleteHomework);
router.post('/:id/submit', requirePermission('homework.submit'), submitHomework);
router.put('/:id/submissions/:submissionId', requirePermission('homework.review'), reviewSubmission);

module.exports = router;
