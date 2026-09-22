const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const subscriptionController = require('../controllers/subscriptionController');

// Public route to fetch available subscription plans & public key
router.get('/plans', (req, res, next) => {
  console.log('📌 [ROUTE MATCHED] GET /api/subscriptions/plans');
  next();
}, subscriptionController.getSubscriptionPlans);

// Public redirect pages for Checkout completion
router.get('/success-page', (req, res, next) => {
  console.log('🎉 [ROUTE MATCHED] GET /api/subscriptions/success-page with query:', req.query);
  next();
}, subscriptionController.handleSuccessPage);

router.get('/cancel-page', (req, res, next) => {
  console.log('🔴 [ROUTE MATCHED] GET /api/subscriptions/cancel-page');
  next();
}, subscriptionController.handleCancelPage);

// Webhook route for Stripe events
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  console.log('📡 [ROUTE MATCHED] POST /api/subscriptions/webhook');
  next();
}, subscriptionController.handleWebhook);

// Protected routes (requires user authentication)
router.post('/create-checkout-session', auth, (req, res, next) => {
  console.log('💳 [ROUTE MATCHED] POST /api/subscriptions/create-checkout-session by User:', req.user?._id || req.user?.id);
  next();
}, subscriptionController.createCheckoutSession);

router.post('/confirm', auth, (req, res, next) => {
  console.log('🚀 [ROUTE MATCHED] POST /api/subscriptions/confirm by User:', req.user?._id || req.user?.id);
  next();
}, subscriptionController.confirmSubscription);

router.get('/my-subscription', auth, (req, res, next) => {
  console.log('🔍 [ROUTE MATCHED] GET /api/subscriptions/my-subscription by User:', req.user?._id || req.user?.id);
  next();
}, subscriptionController.getMySubscription);

router.post('/cancel', auth, (req, res, next) => {
  console.log('🛑 [ROUTE MATCHED] POST /api/subscriptions/cancel by User:', req.user?._id || req.user?.id);
  next();
}, subscriptionController.cancelSubscription);

router.get('/check-session-status', auth, (req, res, next) => {
  console.log('🔍 [ROUTE MATCHED] GET /api/subscriptions/check-session-status by User:', req.user?._id || req.user?.id);
  next();
}, subscriptionController.checkSessionStatus);

module.exports = router;
