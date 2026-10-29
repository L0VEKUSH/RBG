const express = require('express');
const router = express.Router();
const {
  createFaculty, getAllFaculty, getFacultyById, updateFaculty,
  deleteFaculty, getMyProfile, applyLeave, updateLeaveStatus, getFacultyStats,
} = require('../controllers/faculty.controller');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');

router.use(protect);

router.get('/my-profile', requirePermission('teachers.view'), getMyProfile);
router.get('/stats', requirePermission('teachers.view'), getFacultyStats);

router.route('/')
  .get(requirePermission('teachers.view'), getAllFaculty)
  .post(requirePermission('teachers.create'), createFaculty);

router.route('/:id')
  .get(requirePermission('teachers.view'), getFacultyById)
  .put(requirePermission('teachers.update'), updateFaculty)
  .delete(requireRole('super_admin', 'school_admin', 'admin'), deleteFaculty);

router.post('/:id/leave', requirePermission('teachers.create'), applyLeave);
router.put('/:id/leave/:leaveId', requirePermission('teachers.update'), updateLeaveStatus);

module.exports = router;
