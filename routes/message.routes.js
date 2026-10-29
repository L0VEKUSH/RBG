const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { 
    getMyMessages, sendMessage, getMessageThread, markAsRead, getUnreadCount
} = require('../controllers/message.controller');

const router = express.Router();

router.use(protect);

router.get('/', getMyMessages);
router.post('/', sendMessage);
router.get('/unread-count', getUnreadCount);
router.get('/:id', getMessageThread);
router.put('/:id/read', markAsRead);

module.exports = router;
