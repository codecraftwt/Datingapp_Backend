const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const notificationController = require('../controllers/notificationController');

router.get('/unread', auth, notificationController.getUnreadNotifications);
router.put('/mark-read', auth, notificationController.markAsRead);
router.put('/mark-likes-read', auth, notificationController.markLikesAsRead);
router.put('/mark-matches-read', auth, notificationController.markMatchesAsRead);
router.get('/all', auth, notificationController.getAllNotifications);

module.exports = router;
