const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireHomeworkClassAccess } = require('../middleware/authorization.middleware');
const { validateHomeworkSubmission } = require('../validators/homework.validator');
const { 
    getHomework, createHomework, getMyHomework, getClassHomework, 
    getHomeworkById, updateHomework, deleteHomework, submitHomework, reviewSubmission,
    uploadHomeworkAttachment,
} = require('../controllers/homework.controller');
const { createSingleUpload, handleMulterError } = require('../middleware/upload');

const router = express.Router();

router.use(protect);

const homeworkViewRoles = ['super_admin', 'school_admin', 'admin', 'teacher', 'class_teacher', 'faculty', 'student', 'parent'];
const homeworkManagerOrTeacherRoles = ['super_admin', 'school_admin', 'admin', 'teacher', 'class_teacher', 'faculty'];

router.get('/', requireRole(...homeworkViewRoles), requirePermission('homework.view', 'homework.view-own', 'homework.view-linked', 'homework.view-assigned', 'homework.manage', 'homework.manage-any'), getHomework);
router.post('/', requireRole(...homeworkManagerOrTeacherRoles), requirePermission('homework.create'), createHomework);
router.get('/my-homework', requireRole('student', 'parent'), requirePermission('homework.view', 'homework.view-own', 'homework.view-linked'), getMyHomework);
router.get('/class/:class', requireRole(...homeworkViewRoles), requirePermission('homework.view', 'homework.view-assigned', 'homework.view-linked'), requireHomeworkClassAccess('class'), getClassHomework);
router.get('/:id', requireRole(...homeworkViewRoles), requirePermission('homework.view', 'homework.view-own', 'homework.view-linked', 'homework.view-assigned', 'homework.manage', 'homework.manage-any'), getHomeworkById);
router.put('/:id', requireRole(...homeworkManagerOrTeacherRoles), requirePermission('homework.update-own'), updateHomework);
router.post('/:id/attachments', requireRole(...homeworkManagerOrTeacherRoles), requirePermission('homework.update-own'), createSingleUpload(['attachment', 'file'], 'document'), handleMulterError, uploadHomeworkAttachment);
router.delete('/:id', requireRole(...homeworkManagerOrTeacherRoles), requirePermission('homework.update-own'), deleteHomework);
router.post('/:id/submit', requireRole('student'), requirePermission('homework.submit'), validateHomeworkSubmission, submitHomework);
router.put('/:id/submissions/:submissionId', requireRole(...homeworkManagerOrTeacherRoles), requirePermission('homework.review'), reviewSubmission);

module.exports = router;
