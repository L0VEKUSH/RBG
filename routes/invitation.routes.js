'use strict';

const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requirePermission, requireRole } = require('../middleware/authorization.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  studentInvitationValidation,
  teacherInvitationValidation,
} = require('../validators/invitation.validator');
const { inviteStudent, inviteTeacher } = require('../controllers/invitation.controller');

const router = express.Router();
router.use(protect, requireRole('school_admin', 'admin'));

router.post('/students', requirePermission('students.create'), studentInvitationValidation, validate, inviteStudent);
router.post('/teachers', requirePermission('teachers.create'), teacherInvitationValidation, validate, inviteTeacher);

module.exports = router;
