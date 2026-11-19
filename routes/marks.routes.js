const express = require('express');
const router = express.Router();
const {
  addMarks, getStudentMarks, getClassMarks, publishMarks,
  computeRank, getMyMarks, deleteMarks, getClassStats,
} = require('../controllers/marks.controller');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');

router.use(protect);

router.get('/my-marks', requirePermission('results.view-own'), getMyMarks);
router.get('/class/:class', requirePermission('marks.view', 'results.view'), requireClassAccess('class'), getClassMarks);
router.get('/stats', requirePermission('results.view'), getClassStats);
router.post('/publish', requireRole('super_admin', 'admin', 'principal', 'exam_coordinator'), requirePermission('results.publish'), publishMarks);
router.post('/rank', requirePermission('results.generate'), computeRank);

router.route('/')
  .post(requirePermission('marks.enter'), addMarks);

router.get('/student/:studentId', requirePermission('marks.view', 'results.view', 'results.view-own', 'results.view-linked'), getStudentMarks);
router.delete('/:id', requireRole('super_admin', 'school_admin', 'admin'), deleteMarks);

module.exports = router;
