const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getAttendanceReport, getMarksReport, getFeesReport, getStudentsReport, getLibraryReport 
} = require('../controllers/report.controller');

const router = express.Router();

router.use(protect);

router.get('/attendance', requireRole('super_admin', 'school_admin', 'principal', 'teacher'), getAttendanceReport);
router.get('/marks', requireRole('super_admin', 'school_admin', 'principal', 'teacher'), getMarksReport);
router.get('/fees', requireRole('super_admin', 'school_admin', 'accountant'), getFeesReport);
router.get('/students', requireRole('super_admin', 'school_admin', 'principal'), getStudentsReport);
router.get('/library', requireRole('super_admin', 'school_admin', 'librarian'), getLibraryReport);

module.exports = router;
