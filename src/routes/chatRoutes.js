const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

router.get('/messages', auth, chatController.getMessages);
router.post('/messages', auth, chatController.sendMessage);
router.get('/messages/:selectedUserId', auth, chatController.getChatMessages);
router.post('/messages/:messageId/react', auth, chatController.reactToMessage);
router.post('/messages/:messageId/pin', auth, chatController.pinMessage);
router.post('/messages/:messageId/star', auth, chatController.starMessage);
router.put('/messages/:messageId', auth, chatController.editMessage);
router.delete('/messages/:messageId', auth, chatController.deleteMessage);
router.delete('/messages/clear-all', auth, chatController.clearAllChats);
router.delete('/messages/clear/:selectedUserId', auth, chatController.clearChat);

// Public media streaming routes (no auth required so native audio/video players can stream directly)
router.get(['/media/:mediaId', '/chat/media/:mediaId'], chatController.getChatMediaById);
router.get(['/file/:filename', '/chat/file/:filename'], chatController.getChatMediaByName);

// Support both /api/chat/upload and /api/chat/chat/upload
router.post(['/upload', '/chat/upload'], auth, (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      console.error('[ChatUpload] Multer upload error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, message: 'File size exceeds maximum limit (max 100MB).' });
      }
      return res.status(400).json({ success: false, message: err.message || 'File upload error.' });
    }
    if (req.files && req.files.length > 0) {
      req.file = req.files[0];
    }
    next();
  });
}, chatController.uploadChatMedia);

module.exports = router;
