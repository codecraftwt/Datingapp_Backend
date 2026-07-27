const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

router.get('/messages', auth, chatController.getMessages);
router.get('/messages/:selectedUserId', auth, chatController.getChatMessages);
router.put('/messages/:messageId', auth, chatController.editMessage);
router.delete('/messages/:messageId', auth, chatController.deleteMessage);
router.delete('/messages/clear-all', auth, chatController.clearAllChats);
router.delete('/messages/clear/:selectedUserId', auth, chatController.clearChat);

// Support both /api/chat/upload and /api/chat/chat/upload
router.post('/upload', auth, upload.single('file'), chatController.uploadChatMedia);
router.post('/chat/upload', auth, upload.single('file'), chatController.uploadChatMedia);

module.exports = router;
