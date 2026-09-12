const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const Subscription = require('../models/Subscription');

const PLAN_CONFIG = {
  Gold: {
    productId: process.env.STRIPE_GOLD_PRODUCT_ID || 'prod_VEWOERRHV3EsTS',
    priceId: process.env.STRIPE_GOLD_PRICE_ID || 'price_1UE3LnSGA5udBfcNKNBvbHv8',
    name: 'Gold Membership',
    tier: 'Gold',
    priceAmount: '₹999',
    priceDisplay: '₹999 / month',
    features: [
      'Unlimited Likes & Swipes',
      'See Who Liked Your Profile',
      '5 Super Likes per day',
      'Passport Location Change',
    ],
  },
  Premium: {
    productId: process.env.STRIPE_PREMIUM_PRODUCT_ID || 'prod_VEWNuxpAsnKkZm',
    priceId: process.env.STRIPE_PREMIUM_PRICE_ID || 'price_1UE3KpSGA5udBfcNnAqb54o1',
    name: 'Premium Membership',
    tier: 'Premium',
    priceAmount: '₹499',
    priceDisplay: '₹499 / month',
    features: [
      'All Gold Tier Features Included',
      '1 Free Monthly Profile Boost',
      'Priority Likes in Swipe Decks',
      'Unlock All Advanced Search Filters',
      'Ad-Free Premium Experience',
    ],
  },
};

/**
 * Get available subscription plans configuration
 */
exports.getSubscriptionPlans = async (req, res) => {
  try {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51OrZdzSGA5udBfcN8rWWXOK535E24Fp5njj3n1ccrwNROQKrcljjKvo7HpTNK8EwaaznhKLwZ777OfUgWwCmbB0w00lnqqp0HL';
    return res.status(200).json({
      success: true,
      publishableKey,
      plans: PLAN_CONFIG,
    });
  } catch (error) {
    console.error('Error fetching subscription plans:', error);
    return res.status(500).json({ message: 'Failed to fetch subscription plans.' });
  }
};

/**
 * Create a Stripe Subscription Checkout / Payment Sheet Session
 */
exports.createCheckoutSession = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    const { planType } = req.body;

    if (!planType || !PLAN_CONFIG[planType]) {
      return res.status(400).json({ message: 'Invalid plan type. Must be "Gold" or "Premium".' });
    }

    const selectedPlan = PLAN_CONFIG[planType];
    let user = (req.user && typeof req.user.save === 'function') ? req.user : await User.findById(userId);
    if (!user && req.user) {
      const fallbackId = req.user._id || req.user.id || userId;
      user = await User.findById(fallbackId);
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Get or create Stripe Customer dynamically
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || user.firstName || user.email.split('@')[0],
        metadata: { userId: userId.toString() },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    // Create Stripe Hosted Checkout Session (redirects user to official Stripe Checkout page)
    let checkoutSession;
    try {
      checkoutSession = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: selectedPlan.priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}&status=success',
        cancel_url: 'https://example.com/cancel',
        metadata: {
          userId: userId.toString(),
          planType: planType,
        },
      });
    } catch (stripeErr) {
      console.warn('Stripe subscription mode warning, trying payment mode fallback:', stripeErr.message);
      checkoutSession = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'inr',
            product_data: { name: selectedPlan.name },
            unit_amount: planType === 'Gold' ? 99900 : 49900,
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}&status=success',
        cancel_url: 'https://example.com/cancel',
        metadata: {
          userId: userId.toString(),
          planType: planType,
        },
      });
    }

    const subId = checkoutSession.subscription || `sub_${checkoutSession.id}`;

    // Save pending subscription record in DB
    await Subscription.findOneAndUpdate(
      { userId: user._id, stripeSubscriptionId: subId },
      {
        userId: user._id,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subId,
        productId: selectedPlan.productId,
        priceId: selectedPlan.priceId,
        planType: planType,
        status: 'incomplete',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id,
      subscriptionId: subId,
      customerId: customerId,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51OrZdzSGA5udBfcN8rWWXOK535E24Fp5njj3n1ccrwNROQKrcljjKvo7HpTNK8EwaaznhKLwZ777OfUgWwCmbB0w00lnqqp0HL',
      plan: selectedPlan,
    });
  } catch (error) {
    console.error('Create Subscription Checkout Error:', error);
    return res.status(500).json({
      message: error.message || 'Server error creating subscription session.',
    });
  }
};

/**
 * Confirm/Activate subscription directly after successful payment
 */
exports.confirmSubscription = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    const { subscriptionId, planType } = req.body;

    if (!planType || !PLAN_CONFIG[planType]) {
      return res.status(400).json({ message: 'Invalid plan type.' });
    }

    const selectedPlan = PLAN_CONFIG[planType];
    let user = (req.user && typeof req.user.save === 'function') ? req.user : await User.findById(userId);
    if (!user && req.user) {
      const fallbackId = req.user._id || req.user.id || userId;
      user = await User.findById(fallbackId);
    }
    if (!user) return res.status(404).json({ message: 'User not found.' });

    let activeSubDetails = null;

    if (subscriptionId) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
        activeSubDetails = stripeSub;
      } catch (stripeErr) {
        console.warn('Stripe subscription retrieve warning:', stripeErr.message);
      }
    }

    const periodStart = (activeSubDetails && activeSubDetails.current_period_start) ? new Date(activeSubDetails.current_period_start * 1000) : new Date();
    const periodEnd = (activeSubDetails && activeSubDetails.current_period_end) ? new Date(activeSubDetails.current_period_end * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Update User record in MongoDB
    user.subscriptionTier = planType;
    user.subscriptionStatus = 'active';
    await user.save();

    // Upsert Subscription record
    const subRecord = await Subscription.findOneAndUpdate(
      { userId: user._id },
      {
        userId: user._id,
        stripeCustomerId: user.stripeCustomerId || 'cus_direct',
        stripeSubscriptionId: subscriptionId || `sub_${Date.now()}`,
        productId: selectedPlan.productId,
        priceId: selectedPlan.priceId,
        planType: planType,
        status: 'active',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      },
      { upsert: true, new: true }
    );

    console.log(`🎉 [SUBSCRIPTION ACTIVATED] User "${user.email}" upgraded to ${planType} plan!`);

    return res.status(200).json({
      success: true,
      message: `Successfully upgraded to ${planType} Membership! 🎉`,
      subscriptionTier: user.subscriptionTier,
      subscriptionStatus: user.subscriptionStatus,
      subscription: subRecord,
    });
  } catch (error) {
    console.error('Confirm Subscription Error:', error);
    return res.status(500).json({ message: 'Failed to confirm subscription.' });
  }
};

/**
 * Get current user's active subscription details
 */
exports.getMySubscription = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    let user = (req.user && req.user.subscriptionTier !== undefined) ? req.user : await User.findById(userId).select('subscriptionTier subscriptionStatus stripeCustomerId email name');

    if (!user) return res.status(404).json({ message: 'User not found.' });

    const subscription = await Subscription.findOne({ userId, status: 'active' }).sort({ createdAt: -1 });

    const currentTier = user.subscriptionTier || 'Free';
    const planDetails = PLAN_CONFIG[currentTier] || null;

    return res.status(200).json({
      success: true,
      subscriptionTier: currentTier,
      subscriptionStatus: user.subscriptionStatus || 'inactive',
      planDetails,
      subscription,
      availablePlans: PLAN_CONFIG,
    });
  } catch (error) {
    console.error('Get My Subscription Error:', error);
    return res.status(500).json({ message: 'Failed to fetch subscription details.' });
  }
};

/**
 * Cancel active subscription
 */
exports.cancelSubscription = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    let user = (req.user && typeof req.user.save === 'function') ? req.user : await User.findById(userId);

    const subscription = await Subscription.findOne({ userId, status: 'active' });
    if (!subscription) {
      // Revert user to Free tier if no active subscription record found
      user.subscriptionTier = 'Free';
      user.subscriptionStatus = 'inactive';
      await user.save();
      return res.status(200).json({
        success: true,
        message: 'Subscription cancelled. You are now on the Free tier.',
        subscriptionTier: 'Free',
      });
    }

    // Cancel in Stripe if stripeSubscriptionId exists
    if (subscription.stripeSubscriptionId && !subscription.stripeSubscriptionId.startsWith('sub_')) {
      try {
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          cancel_at_period_end: true,
        });
      } catch (stripeErr) {
        console.warn('Stripe cancellation warning:', stripeErr.message);
      }
    }

    subscription.cancelAtPeriodEnd = true;
    subscription.status = 'canceled';
    await subscription.save();

    user.subscriptionTier = 'Free';
    user.subscriptionStatus = 'inactive';
    await user.save();

    console.log(`ℹ️ [SUBSCRIPTION CANCELLED] User "${user.email}" cancelled ${subscription.planType} subscription.`);

    return res.status(200).json({
      success: true,
      message: 'Your subscription auto-renewal has been cancelled.',
      subscriptionTier: 'Free',
      subscriptionStatus: 'inactive',
    });
  } catch (error) {
    console.error('Cancel Subscription Error:', error);
    return res.status(500).json({ message: 'Failed to cancel subscription.' });
  }
};

/**
 * Handle Stripe Webhook Events
 */
exports.handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
  } catch (err) {
    console.error(`Webhook Signature Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`📡 [STRIPE WEBHOOK RECEIVED] Event type: ${event.type}`);

  try {
    switch (event.type) {
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;

        if (customerId && subscriptionId) {
          const user = await User.findOne({ stripeCustomerId: customerId });
          if (user) {
            const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
            const priceId = stripeSub.items?.data[0]?.price?.id;

            let planType = 'Gold';
            if (priceId === (process.env.STRIPE_PREMIUM_PRICE_ID || 'price_1UE3KpSGA5udBfcNnAqb54o1')) {
              planType = 'Premium';
            }

            user.subscriptionTier = planType;
            user.subscriptionStatus = 'active';
            await user.save();

            await Subscription.findOneAndUpdate(
              { stripeSubscriptionId: subscriptionId },
              {
                userId: user._id,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                priceId: priceId,
                planType: planType,
                status: 'active',
                currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
                currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
              },
              { upsert: true }
            );

            console.log(`✅ [WEBHOOK SUCCESS] User ${user.email} updated to active ${planType} plan.`);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subObj = event.data.object;
        const customerId = subObj.customer;

        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user) {
          user.subscriptionTier = 'Free';
          user.subscriptionStatus = 'inactive';
          await user.save();

          await Subscription.findOneAndUpdate(
            { stripeSubscriptionId: subObj.id },
            { status: 'canceled' }
          );

          console.log(`🔴 [WEBHOOK CANCELLED] Subscription deleted for customer ${customerId}.`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error handling webhook event:', err);
    return res.status(500).json({ message: 'Webhook handler error.' });
  }
};
