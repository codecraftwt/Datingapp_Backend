const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', auth, authController.logout);
router.post('/logout-all-devices', authController.logoutAllDevices);
router.post('/forgot-password', authController.forgotPassword);
router.post('/verify-reset-otp', authController.verifyResetOtp);
router.post('/reset-password', authController.resetPassword);
router.delete('/delete-account', auth, authController.deleteAccount);
router.post('/send-mobile-otp', auth, authController.sendMobileOtp);
router.post('/verify-mobile-otp', auth, authController.verifyMobileOtp);

module.exports = router;
