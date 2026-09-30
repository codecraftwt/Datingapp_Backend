const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');

// Public/Auth routes for user contact reports
router.post('/submit', contactController.submitReport);
router.post('/', contactController.submitReport);
router.get('/my-reports', contactController.getMySubmittedContactReports);

module.exports = router;
