const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

router.get('/messages', auth, chatController.getMessages);
router.post('/messages', auth, chatController.sendMessage);
router.get('/messages/:selectedUserId', auth, chatController.getChatMessages);
router.put('/messages/:messageId', auth, chatController.editMessage);
router.delete('/messages/:messageId', auth, chatController.deleteMessage);
router.delete('/messages/clear-all', auth, chatController.clearAllChats);
router.delete('/messages/clear/:selectedUserId', auth, chatController.clearChat);

// Support both /api/chat/upload and /api/chat/chat/upload
router.post(['/upload', '/chat/upload'], auth, upload.any(), (req, res, next) => {
  if (req.files && req.files.length > 0) {
    req.file = req.files[0];
  }
  next();
}, chatController.uploadChatMedia);

module.exports = router;
