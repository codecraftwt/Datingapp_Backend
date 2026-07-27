const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const authController = require('../controllers/authController'); // for DELETE /profile
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

router.put('/questionnaire', auth, profileController.saveQuestionnaire);
router.put('/location', auth, profileController.updateLocation);
router.get('/questionnaire', auth, profileController.getQuestionnaires);
router.get('/profile', auth, profileController.getProfile);
router.get('/online-users', auth, profileController.getOnlineUsers);
router.post('/upload', auth, upload.single('photo'), profileController.uploadImage);
router.post('/remove-photo', auth, profileController.removeProfilePhoto);
router.post('/remove-profile', auth, profileController.removeProfile);

// Map DELETE /profile to deleteAccount for backward compatibility with the frontend
router.delete('/profile', auth, authController.deleteAccount);

module.exports = router;
