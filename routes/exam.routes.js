const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getExams, createExam, getUpcomingExams, getClassExams, getExamById, updateExam, deleteExam
} = require('../controllers/exam.controller');

const router = express.Router();

router.use(protect);

router.get('/', requirePermission('exams.view'), getExams);
router.post('/', requirePermission('exams.create'), createExam);
router.get('/upcoming', requirePermission('exams.view', 'exams.view-assigned', 'exams.view-linked'), getUpcomingExams);
router.get('/class/:class', requirePermission('exams.view', 'exams.view-assigned', 'exams.view-linked'), requireClassAccess('class'), getClassExams);
router.get('/:id', requirePermission('exams.view', 'exams.view-assigned', 'exams.view-linked'), getExamById);
router.put('/:id', requirePermission('exams.update'), updateExam);
router.delete('/:id', requirePermission('exams.update'), deleteExam);

module.exports = router;
