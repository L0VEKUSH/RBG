const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getBuses, addBus, updateBus, getRoutes, addRoute, updateRoute,
    assignStudent, getStudentTransport, getMyTransport, getStats
} = require('../controllers/transport.controller');

const router = express.Router();

router.use(protect);

router.get('/buses', requirePermission('transport.view', 'transport.view-own-route'), getBuses);
router.post('/buses', requirePermission('transport.manage'), addBus);
router.put('/buses/:id', requirePermission('transport.manage'), updateBus);

router.get('/routes', requirePermission('transport.view', 'transport.view-own-route', 'transport.view-own', 'transport.view-linked'), getRoutes);
router.post('/routes', requirePermission('transport.manage'), addRoute);
router.put('/routes/:id', requirePermission('transport.manage'), updateRoute);

router.post('/assign', requirePermission('transport.assign'), assignStudent);
router.get('/student/:studentId', requirePermission('transport.view', 'transport.view-linked'), getStudentTransport);
router.get('/my-transport', requirePermission('transport.view-own'), getMyTransport);
router.get('/stats', requirePermission('transport.view', 'transport.report'), getStats);

module.exports = router;
