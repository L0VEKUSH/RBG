const express = require('express');
const router = express.Router();
const {
  getAllStudents, getStudentById, updateStudent,
  deleteStudent, getStudentsByClass, promoteStudents,
  updateFeePayment, getDashboardStats, getMyProfile, issueTC,
  uploadStudentDocument, deleteStudentDocument,
} = require('../controllers/student.controller');
const { createSingleUpload, handleMulterError } = require('../middleware/upload');
const { rejectLegacyPasswordCreation } = require('../controllers/invitation.controller');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireClassAccess } = require('../middleware/authorization.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  updateStudentValidation,
  rejectLegacyStudentFinancialFields,
  transferCertificateValidation,
} = require('../validators/student.validator');

router.use(protect);

router.get('/my-profile', requirePermission('profile.view-own'), getMyProfile);

router.get('/stats', requirePermission('reports.view', 'students.view'), getDashboardStats);

router.get('/class/:class', requirePermission('students.view', 'students.view-assigned'), requireClassAccess('class'), getStudentsByClass);

router.post('/promote', requirePermission('students.promote'), promoteStudents);

router.route('/')
  .get(requirePermission('students.view', 'students.view-basic'), getAllStudents)
  .post(requirePermission('students.create'), rejectLegacyPasswordCreation);

router.route('/:id')
  .get(requirePermission('students.view', 'students.view-assigned', 'students.view-linked', 'profile.view-own', 'students.view-basic'), getStudentById)
  .put(requirePermission('students.update'), rejectLegacyStudentFinancialFields, updateStudentValidation, validate, updateStudent)
  .delete(requirePermission('students.tc'), deleteStudent);

router.post('/:id/documents', requirePermission('students.update'), createSingleUpload(['document', 'file'], 'document'), handleMulterError, uploadStudentDocument);
router.delete('/:id/documents/:documentId', requirePermission('students.update'), deleteStudentDocument);

router.post('/:id/tc', requirePermission('students.tc'), transferCertificateValidation, validate, issueTC);

router.put('/:id/fees', requirePermission('fees.collect'), updateFeePayment);

module.exports = router;
