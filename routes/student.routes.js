const express = require('express');
const router = express.Router();
const {
  createStudent, getAllStudents, getStudentById, updateStudent,
  deleteStudent, getStudentsByClass, promoteStudents,
  updateFeePayment, getDashboardStats, getMyProfile, issueTC
} = require('../controllers/student.controller');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { validate } = require('../middleware/validate.middleware');
const { createStudentValidation, updateStudentValidation } = require('../validators/student.validator');

router.use(protect);

router.get('/my-profile', requirePermission('profile.view-own'), getMyProfile);

router.get('/stats', requirePermission('reports.view', 'students.view'), getDashboardStats);

router.get('/class/:class', requirePermission('students.view', 'students.view-assigned'), requireClassAccess('class'), getStudentsByClass);

router.post('/promote', requirePermission('students.promote'), promoteStudents);

router.route('/')
  .get(requirePermission('students.view', 'students.view-basic'), getAllStudents)
  .post(requirePermission('students.create'), createStudentValidation, validate, createStudent);

router.route('/:id')
  .get(requirePermission('students.view', 'students.view-assigned', 'students.view-linked', 'profile.view-own', 'students.view-basic'), requireOwnership('Student', 'id'), getStudentById)
  .put(requirePermission('students.update'), updateStudentValidation, validate, updateStudent)
  .delete(requirePermission('students.tc'), deleteStudent);

router.post('/:id/tc', requirePermission('students.tc'), issueTC);

router.put('/:id/fees', requirePermission('fees.collect'), updateFeePayment);

module.exports = router;
