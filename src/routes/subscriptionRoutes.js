const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const subscriptionController = require('../controllers/subscriptionController');

// Public route to fetch available subscription plans & public key
router.get('/plans', subscriptionController.getSubscriptionPlans);

// Public redirect pages for Checkout completion
router.get('/success-page', subscriptionController.handleSuccessPage);
router.get('/cancel-page', subscriptionController.handleCancelPage);

// Webhook route for Stripe events
router.post('/webhook', express.raw({ type: 'application/json' }), subscriptionController.handleWebhook);

// Protected routes (requires user authentication)
router.post('/create-checkout-session', auth, subscriptionController.createCheckoutSession);
router.post('/confirm', auth, subscriptionController.confirmSubscription);
router.get('/my-subscription', auth, subscriptionController.getMySubscription);
router.post('/cancel', auth, subscriptionController.cancelSubscription);

module.exports = router;
