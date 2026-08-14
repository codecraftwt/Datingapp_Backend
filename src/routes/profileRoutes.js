const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const authController = require('../controllers/authController'); // for DELETE /profile
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

router.put('/questionnaire', auth, profileController.saveQuestionnaire);
router.put('/location', auth, profileController.updateLocation);
router.delete('/location', auth, profileController.clearCurrentLocation);
router.get(['/questionnaire-options', '/questionnarie-options', '/options', '/questionnaire/options'], profileController.getQuestionnaireOptions);
router.get('/questionnaire', auth, profileController.getQuestionnaires);
router.get(['/profile', '/'], auth, profileController.getProfile);
router.get('/online-users', auth, profileController.getOnlineUsers);
router.post(['/upload', '/uploads'], auth, upload.any(), (req, res, next) => {
  if (req.files && req.files.length > 0) {
    req.file = req.files[0];
  }
  next();
}, profileController.uploadImage);
router.post('/remove-photo', auth, profileController.removeProfilePhoto);
router.post('/remove-profile', auth, profileController.removeProfile);
router.put('/fcm-token', auth, profileController.updateFcmToken);
router.put('/hide-media', auth, profileController.hideProfileMedia);
router.post('/hide-media', auth, profileController.hideProfileMedia);
router.put('/hide', auth, profileController.hideProfileMedia);
router.post('/hide', auth, profileController.hideProfileMedia);

router.put('/unhide-media', auth, profileController.unhideProfileMedia);
router.post('/unhide-media', auth, profileController.unhideProfileMedia);
router.put('/unhide', auth, profileController.unhideProfileMedia);
router.post('/unhide', auth, profileController.unhideProfileMedia);

router.get('/hidden-media', auth, profileController.getHiddenMedia);
router.get('/hidden', auth, profileController.getHiddenMedia);

// Map DELETE /profile to deleteAccount for backward compatibility with the frontend
router.delete('/profile', auth, authController.deleteAccount);

module.exports = router;
