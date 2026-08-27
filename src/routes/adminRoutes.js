const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// 1. Admin Registration API Endpoint
router.post('/register', adminController.registerAdmin);

// 2. Admin Login API Endpoint
router.post('/login', adminController.loginAdmin);

// 3. Admin Fetch All Registered Users API Endpoint
router.get('/users', adminController.getAllRegisteredUsers);

// 4. Admin Fetch All User Complaint Reports API Endpoint
router.get('/reports', adminController.getAllReports);

// 5. Admin Update User Report Status API Endpoint
router.put('/reports/:reportId', adminController.updateReportStatus);

// 6. Admin Issue Warning to Reported User API Endpoint
router.post('/warn-user', adminController.warnUser);

module.exports = router;
