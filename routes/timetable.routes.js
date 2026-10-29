const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getTimetable, createTimetable, updateTimetable, 
    getClassTimetable, getTeacherTimetable, getMyTimetable
} = require('../controllers/timetable.controller');

const router = express.Router();

router.use(protect);

router.get('/', requirePermission('timetable.view'), getTimetable);
router.post('/', requirePermission('timetable.manage'), createTimetable);
router.put('/:id', requirePermission('timetable.manage'), updateTimetable);
router.get('/class/:class', requirePermission('timetable.view', 'timetable.view-assigned', 'timetable.view-linked', 'timetable.view-own'), requireClassAccess('class'), getClassTimetable);
router.get('/teacher/:teacherId', requirePermission('timetable.view', 'timetable.view-assigned'), getTeacherTimetable);
router.get('/my-timetable', requirePermission('timetable.view-own'), getMyTimetable);

module.exports = router;
