const express = require('express');
const router = express.Router();
const {
  getAllFaculty, getFacultyById, updateFaculty,
  deleteFaculty, getMyProfile, applyLeave, updateLeaveStatus, getFacultyStats,
} = require('../controllers/faculty.controller');
const { rejectLegacyPasswordCreation } = require('../controllers/invitation.controller');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const ErrorResponse = require('../utils/errorResponse');
const facultyLeaveService = require('../services/faculty-leave.service');

const requireFacultyLeaveApply = (req, res, next) => {
  if (!req.user) return next(new ErrorResponse('Not authenticated', 401));
  if (!facultyLeaveService.canApplyFacultyLeave(req.user)) {
    return next(new ErrorResponse('Permission denied. Required: leave.apply', 403));
  }
  next();
};

router.use(protect);

router.get('/my-profile', requirePermission('teachers.view'), getMyProfile);
router.get('/stats', requirePermission('teachers.view'), getFacultyStats);

router.route('/')
  .get(requirePermission('teachers.view'), getAllFaculty)
  .post(requirePermission('teachers.create'), rejectLegacyPasswordCreation);

router.route('/:id')
  .get(requirePermission('teachers.view'), getFacultyById)
  .put(requirePermission('teachers.update'), updateFaculty)
  .delete(requireRole('super_admin', 'school_admin', 'admin'), deleteFaculty);

router.post('/:id/leave', requireFacultyLeaveApply, applyLeave);
router.put('/:id/leave/:leaveId', requirePermission('leave.approve', 'leave.reject'), updateLeaveStatus);

module.exports = router;
