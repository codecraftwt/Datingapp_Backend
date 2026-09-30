const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');

const contactController = require('../controllers/contactController');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.post('/logout-all-devices', authController.logoutAllDevices);
router.post('/forgot-password', authController.forgotPassword);
router.post('/verify-reset-otp', authController.verifyResetOtp);
router.post('/reset-password', authController.resetPassword);
router.put('/change-password', auth, authController.changePassword);
router.post('/change-password', auth, authController.changePassword);
router.delete('/delete-account', auth, authController.deleteAccount);
router.post('/send-mobile-otp', auth, authController.sendMobileOtp);
router.post('/verify-mobile-otp', auth, authController.verifyMobileOtp);

// Contact Support Form Fallback Endpoints
router.post('/contact/submit', contactController.submitReport);
router.post('/contact', contactController.submitReport);
router.post('/contact-us', contactController.submitReport);

module.exports = router;
