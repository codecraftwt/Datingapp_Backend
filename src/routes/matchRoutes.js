const express = require('express');
const router = express.Router();
const matchController = require('../controllers/matchController');
const auth = require('../middleware/auth');

router.post('/like', auth, matchController.likeUser);
router.get('/likes', auth, matchController.getLikes);
router.get('/matches', auth, matchController.getMatches);
router.post('/reject-like', auth, matchController.rejectLike);
router.get('/swiped-ids', auth, matchController.getSwipedIds);
router.post('/unmatch', auth, matchController.unmatchUser);
router.post('/block', auth, matchController.blockUser);
router.post('/report', auth, matchController.reportUser);
router.post('/undo-swipe', auth, matchController.undoSwipe);

module.exports = router;
