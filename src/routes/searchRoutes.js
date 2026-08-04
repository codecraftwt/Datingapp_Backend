const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const auth = require('../middleware/auth');

// Advanced Search endpoints (supports both POST with body and GET with query parameters)
router.post('/', auth, searchController.advancedSearch);
router.get('/', auth, searchController.advancedSearch);

// Filter master options endpoint
router.get('/options', auth, searchController.getFilterOptions);

// User search preferences endpoints
router.get('/preferences', auth, searchController.getSearchPreferences);
router.put('/preferences', auth, searchController.updateSearchPreferences);

module.exports = router;
