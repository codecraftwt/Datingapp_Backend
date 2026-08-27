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
router.get('/online-users', auth, profileController.getOnlineUsers);
router.get(['/hidden-media', '/hidden'], auth, profileController.getHiddenMedia);

router.post(['/upload', '/uploads'], auth, upload.any(), (req, res, next) => {
  if (req.files && req.files.length > 0) {
    req.file = req.files[0];
  }
  next();
}, profileController.uploadImage);
router.post('/remove-photo', auth, profileController.removeProfilePhoto);
router.post('/remove-profile', auth, profileController.removeProfile);
router.put('/fcm-token', auth, profileController.updateFcmToken);
router.get('/fcm-token', auth, profileController.getFcmToken);
router.post('/test-fcm-push', auth, profileController.testFcmPush);
router.get(['/my-reports', '/reports/my'], auth, profileController.getMyReports);
router.get('/active-warning', auth, profileController.getActiveWarning);
router.post('/acknowledge-warning', auth, profileController.acknowledgeWarning);

router.put(['/hide-media', '/hide'], auth, profileController.hideProfileMedia);
router.post(['/hide-media', '/hide'], auth, profileController.hideProfileMedia);

router.put(['/unhide-media', '/unhide'], auth, profileController.unhideProfileMedia);
router.post(['/unhide-media', '/unhide'], auth, profileController.unhideProfileMedia);

// Main Profile Photo Routes (Slot #1)
router.post('/main-photo', auth, upload.any(), (req, res, next) => {
  if (req.files && req.files.length > 0) req.file = req.files[0];
  next();
}, profileController.uploadMainPhoto);
router.put('/main-photo', auth, upload.any(), (req, res, next) => {
  if (req.files && req.files.length > 0) req.file = req.files[0];
  next();
}, profileController.uploadMainPhoto);
router.delete('/main-photo', auth, profileController.removeMainPhoto);

// Gallery & Preview Media Routes (Slots #2 - #9)
router.post(['/gallery-media', '/gallery-media/:slotIndex'], auth, upload.any(), (req, res, next) => {
  if (req.files && req.files.length > 0) req.file = req.files[0];
  next();
}, profileController.uploadGalleryMedia);
router.put(['/gallery-media', '/gallery-media/:slotIndex'], auth, upload.any(), (req, res, next) => {
  if (req.files && req.files.length > 0) req.file = req.files[0];
  next();
}, profileController.uploadGalleryMedia);
router.delete(['/gallery-media', '/gallery-media/:slotIndex'], auth, profileController.removeGalleryMedia);
router.get('/gallery-preview', auth, profileController.getGalleryPreview);

// Map DELETE /profile to deleteAccount for backward compatibility with the frontend
router.delete('/profile', auth, authController.deleteAccount);

// Logged-in User Profile endpoint
router.get(['/profile', '/me', '/my-profile'], auth, profileController.getProfile);
router.get('/', auth, profileController.getProfile);

// Dynamic user ID routes MUST be last
router.get(['/user/:userId', '/profile/:userId', '/details/:userId', '/user-profile/:userId', '/:userId'], auth, profileController.getUserById);

module.exports = router;
