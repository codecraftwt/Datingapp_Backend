const express = require('express');
const router = express.Router();
const matchController = require('../controllers/matchController');
const auth = require('../middleware/auth');

router.post('/like', auth, matchController.likeUser);
router.post('/superlike', auth, matchController.superLikeUser);
router.get('/likes', auth, matchController.getLikes);
router.get('/superlike-status', auth, matchController.getSuperLikeStatus);
router.get('/matches', auth, matchController.getMatches);
router.post('/reject-like', auth, matchController.rejectLike);
router.get('/swiped-ids', auth, matchController.getSwipedIds);
router.post('/unmatch', auth, matchController.unmatchUser);
router.post('/block', auth, matchController.blockUser);
router.get(['/blocked-users', '/blocked-users/:userId', '/blocked'], auth, matchController.getBlockedUsers);
router.post(['/unblock', '/unblock/:userId'], auth, matchController.unblockUser);
router.post('/report', auth, matchController.reportUser);
router.post('/undo-swipe', auth, matchController.undoSwipe);

module.exports = router;
