const express = require('express');
const { protect, optionalProtect } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, requireOwnership, requireClassAccess } = require('../middleware/authorization.middleware');
const { 
    getPublicEvents, getUpcomingEvents, getEvents, createEvent,
    getEvent, updateEvent, deleteEvent
} = require('../controllers/event.controller');

const router = express.Router();

router.get('/public', optionalProtect, getPublicEvents);

router.use(protect);
router.get('/upcoming', getUpcomingEvents);
router.get('/', getEvents);
router.post('/', requirePermission('events.create'), createEvent);
router.get('/:id', getEvent);
router.put('/:id', requirePermission('events.update'), updateEvent);
router.delete('/:id', requirePermission('events.delete'), deleteEvent);

module.exports = router;
