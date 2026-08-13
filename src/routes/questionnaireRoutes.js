const express = require('express');
const router = express.Router();
const questionnaireController = require('../controllers/questionnaireController');
const auth = require('../middleware/auth');

// Public or Authenticated route for fetching questionnaire question options
router.get(['/options', '/options-data', '/questionnaire-options', '/questionnarie-options'], questionnaireController.getQuestionnaireOptions);

// Authenticated questionnaire user endpoints
router.get('/me', auth, questionnaireController.getProfile);
router.get('/', auth, questionnaireController.getQuestionnaires);
router.get('/all', auth, questionnaireController.getQuestionnaires);
router.put('/', auth, questionnaireController.saveQuestionnaire);
router.post('/', auth, questionnaireController.saveQuestionnaire);

module.exports = router;
