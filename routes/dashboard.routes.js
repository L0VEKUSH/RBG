const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/authorization.middleware');
const { 
    getAdminDashboard, getPrincipalDashboard, getTeacherDashboard, 
    getStudentDashboard, getParentDashboard, getAccountantDashboard, 
    getLibrarianDashboard, getVicePrincipalDashboard, getAcademicCoordinatorDashboard,
    getAdmissionOfficerDashboard, getExamCoordinatorDashboard, getDriverDashboard,
    getReceptionistDashboard, getHrDashboard, getStaffDashboard
} = require('../controllers/dashboard.controller');

const router = express.Router();

router.use(protect);

router.get('/admin', requireRole('super_admin', 'school_admin'), getAdminDashboard);
router.get('/principal', requireRole('principal'), getPrincipalDashboard);
router.get('/vice_principal', requireRole('vice_principal'), getVicePrincipalDashboard);
router.get('/teacher', requireRole('teacher', 'class_teacher'), getTeacherDashboard);
router.get('/student', requireRole('student'), getStudentDashboard);
router.get('/parent', requireRole('parent'), getParentDashboard);
router.get('/accountant', requireRole('accountant'), getAccountantDashboard);
router.get('/librarian', requireRole('librarian'), getLibrarianDashboard);
router.get('/academic', requireRole('academic_coordinator'), getAcademicCoordinatorDashboard);
router.get('/admissions', requireRole('admission_officer'), getAdmissionOfficerDashboard);
router.get('/exams', requireRole('exam_coordinator'), getExamCoordinatorDashboard);
router.get('/driver', requireRole('driver'), getDriverDashboard);
router.get('/reception', requireRole('receptionist'), getReceptionistDashboard);
router.get('/hr', requireRole('hr'), getHrDashboard);
router.get('/staff', requireRole('staff', 'nurse'), getStaffDashboard);

module.exports = router;
