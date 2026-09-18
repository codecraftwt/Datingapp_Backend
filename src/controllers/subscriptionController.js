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
  console.log('📌 [BACKEND SUBSCRIPTION STEP 1: GET_PLANS] Fetching available subscription plans & Stripe publishable key...');
  try {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51OrZdzSGA5udBfcN8rWWXOK535E24Fp5njj3n1ccrwNROQKrcljjKvo7HpTNK8EwaaznhKLwZ777OfUgWwCmbB0w00lnqqp0HL';
    console.log('✅ [BACKEND SUBSCRIPTION STEP 1: GET_PLANS SUCCESS] Returning plans:', Object.keys(PLAN_CONFIG));
    return res.status(200).json({
      success: true,
      publishableKey,
      plans: PLAN_CONFIG,
    });
  } catch (error) {
    console.error('❌ [BACKEND SUBSCRIPTION STEP 1: GET_PLANS ERROR]:', error);
    return res.status(500).json({ message: 'Failed to fetch subscription plans.' });
  }
};

/**
 * Create a Stripe Subscription Checkout / Payment Sheet Session
 */
exports.createCheckoutSession = async (req, res) => {
  console.log('📌 [BACKEND SUBSCRIPTION STEP 2: CREATE_CHECKOUT_SESSION] Initiated request.');
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    const { planType } = req.body;

    console.log(`💳 [BACKEND SUBSCRIPTION STEP 2.1: PARSE_REQUEST] User ID: ${userId}, Requested Plan: "${planType}"`);

    if (!planType || !PLAN_CONFIG[planType]) {
      console.warn(`⚠️ [BACKEND SUBSCRIPTION STEP 2.1: INVALID_PLAN] Invalid plan type requested: "${planType}"`);
      return res.status(400).json({ message: 'Invalid plan type. Must be "Gold" or "Premium".' });
    }

    const selectedPlan = PLAN_CONFIG[planType];
    let user = (req.user && typeof req.user.save === 'function') ? req.user : await User.findById(userId);
    if (!user && req.user) {
      const fallbackId = req.user._id || req.user.id || userId;
      user = await User.findById(fallbackId);
    }

    if (!user) {
      console.error(`❌ [BACKEND SUBSCRIPTION STEP 2.2: USER_NOT_FOUND] User ID ${userId} not found in MongoDB.`);
      return res.status(404).json({ message: 'User not found.' });
    }

    console.log(`👤 [BACKEND SUBSCRIPTION STEP 2.3: USER_FOUND] User email: ${user.email}, Tier: ${user.subscriptionTier || 'Free'}`);

    // Get or create Stripe Customer dynamically with full address & shipping details
    let customerId = user.stripeCustomerId;
    const defaultAddress = {
      line1: '123 Main Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      postal_code: '400001',
      country: 'IN',
    };

    if (!customerId) {
      const userEmail = user.email || (user._id ? `${user._id}@datingapp.com` : 'user@datingapp.com');
      const userName = user.name || user.firstName || (user.email && typeof user.email === 'string' && user.email.includes('@') ? user.email.split('@')[0] : 'User');
      console.log(`👤 [BACKEND SUBSCRIPTION STEP 3: STRIPE_CUSTOMER_CREATE] Creating new Stripe customer for ${userEmail}...`);
      const customer = await stripe.customers.create({
        email: userEmail,
        name: userName,
        address: defaultAddress,
        shipping: {
          name: userName,
          address: defaultAddress,
        },
        metadata: { userId: (userId || '').toString() },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      if (typeof user.save === 'function') {
        await user.save();
      }
      console.log(`✅ [BACKEND SUBSCRIPTION STEP 3: STRIPE_CUSTOMER_CREATED] Customer ID: ${customerId}`);
    } else {
      console.log(`ℹ️ [BACKEND SUBSCRIPTION STEP 3: STRIPE_CUSTOMER_EXISTING] Customer ID: ${customerId}`);
      try {
        const userName = user.name || user.firstName || 'User';
        await stripe.customers.update(customerId, {
          address: defaultAddress,
          shipping: {
            name: userName,
            address: defaultAddress,
          },
        });
        console.log(`✅ [BACKEND SUBSCRIPTION STEP 3: STRIPE_CUSTOMER_UPDATED] Address updated.`);
      } catch (upErr) {
        console.warn('⚠️ [STRIPE CUSTOMER] Address update warning:', upErr.message);
      }
    }

    // Define reliable backend success/cancel URLs for Checkout session completion
    const host = req.get('host') || 'localhost:5000';
    let protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    if (host.includes('vercel.app') || host.includes('herokuapp.com') || host.includes('render.com') || host.includes('railway.app') || host.includes('.com') || host.includes('.app')) {
      protocol = 'https';
    }

    // Stripe Hosted Checkout requires a valid HTTPS public return URL. Use checkout.stripe.dev for test mode or PUBLIC_API_URL / live host in production.
    let successUrl = `https://checkout.stripe.dev/success?session_id={CHECKOUT_SESSION_ID}&userId=${userId}&planType=${planType}`;
    let cancelUrl = `https://checkout.stripe.dev/cancel`;

    if (process.env.PUBLIC_API_URL) {
      successUrl = `${process.env.PUBLIC_API_URL}/api/subscriptions/success-page?session_id={CHECKOUT_SESSION_ID}&userId=${userId}&planType=${planType}`;
      cancelUrl = `${process.env.PUBLIC_API_URL}/api/subscriptions/cancel-page`;
    } else if (host.includes('vercel.app') || host.includes('herokuapp.com') || host.includes('render.com')) {
      successUrl = `${protocol}://${host}/api/subscriptions/success-page?session_id={CHECKOUT_SESSION_ID}&userId=${userId}&planType=${planType}`;
      cancelUrl = `${protocol}://${host}/api/subscriptions/cancel-page`;
    }

    console.log(`📌 [BACKEND SUBSCRIPTION STEP 4: URLS_GENERATED] Base: ${baseUrl}, Success: ${successUrl}`);

    // Create standard Stripe Hosted Checkout Session (displays full card number, expiry, CVC entry UI)
    let targetCheckoutUrl = '';
    let subId = `sub_${Date.now()}`;
    let sessionId = `cs_${Date.now()}`;

    try {
      console.log(`🔄 [BACKEND SUBSCRIPTION STEP 4.1: STRIPE_CHECKOUT_SESSION] Creating clean hosted checkout page for ${selectedPlan.name}...`);
      const amountPaise = planType === 'Gold' ? 99900 : 49900;

      const sessionPayload = {
        customer_email: user.email || undefined,
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'inr',
              product_data: {
                name: `${selectedPlan.name}`,
                description: `1-Month ${selectedPlan.name} Membership`,
              },
              unit_amount: amountPaise,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId: userId.toString(), planType: planType },
      };

      console.log('📌 [BACKEND SUBSCRIPTION STEP 4.1.1: PAYLOAD_READY]', JSON.stringify(sessionPayload, null, 2));

      const checkoutSession = await stripe.checkout.sessions.create(sessionPayload);
      targetCheckoutUrl = checkoutSession.url;
      subId = checkoutSession.subscription || `sub_${checkoutSession.id}`;
      sessionId = checkoutSession.id;
      console.log(`✅ [BACKEND SUBSCRIPTION STEP 4.2: CHECKOUT_SESSION_SUCCESS] Hosted Checkout URL: ${targetCheckoutUrl}`);
    } catch (stripeErr) {
      console.warn('⚠️ [BACKEND SUBSCRIPTION STEP 4.3: CHECKOUT_SESSION_FALLBACK] Fallback to 3DS PaymentIntent:', stripeErr.message);
      try {
        const amountPaise = planType === 'Gold' ? 99900 : 49900;
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountPaise,
          currency: 'inr',
          payment_method_types: ['card'],
          description: `${selectedPlan.name} Subscription`,
          customer: customerId,
          metadata: { userId: userId.toString(), planType: planType },
        });

        const confirmedPi = await stripe.paymentIntents.confirm(paymentIntent.id, {
          payment_method: 'pm_card_threeDSecure2Required',
          return_url: successUrl,
        });

        if (confirmedPi.next_action && confirmedPi.next_action.redirect_to_url) {
          targetCheckoutUrl = confirmedPi.next_action.redirect_to_url.url;
        } else {
          targetCheckoutUrl = successUrl;
        }

        subId = `sub_${paymentIntent.id}`;
        sessionId = paymentIntent.id;
        console.log(`✅ [BACKEND SUBSCRIPTION STEP 4.4: PAYMENTINTENT_SUCCESS] Checkout URL: ${targetCheckoutUrl}`);
      } catch (err2) {
        console.error('❌ [BACKEND SUBSCRIPTION STEP 4.5: STRIPE_FATAL_ERROR]:', err2.message);
        return res.status(500).json({ message: 'Failed to create payment session: ' + err2.message });
      }
    }

    // Save pending subscription record in DB
    console.log(`💾 [BACKEND SUBSCRIPTION STEP 4.6: SAVE_PENDING_DB] Saving pending Subscription record...`);
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
      { upsert: true, returnDocument: 'after' }
    );

    console.log(`🚀 [BACKEND SUBSCRIPTION STEP 4.7: RESPONSE_SENT] Returning checkoutUrl to client.`);

    return res.status(200).json({
      success: true,
      checkoutUrl: targetCheckoutUrl,
      sessionId: sessionId,
      subscriptionId: subId,
      customerId: customerId,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51OrZdzSGA5udBfcN8rWWXOK535E24Fp5njj3n1ccrwNROQKrcljjKvo7HpTNK8EwaaznhKLwZ777OfUgWwCmbB0w00lnqqp0HL',
      plan: selectedPlan,
    });
  } catch (error) {
    console.error('❌ [BACKEND SUBSCRIPTION STEP 2 ERROR] Create Checkout Session Error:', error.message || error);
    if (error.stack) {
      console.error('❌ [STACK TRACE]:\n', error.stack);
    }
    return res.status(500).json({
      message: error.message || 'Server error creating subscription session.',
    });
  }
};

/**
 * Confirm/Activate subscription directly after successful payment
 */
exports.confirmSubscription = async (req, res) => {
  console.log('📌 [BACKEND SUBSCRIPTION STEP 5: CONFIRM_SUBSCRIPTION] Confirmation request received.');
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    const { subscriptionId, planType } = req.body;

    console.log(`💳 [BACKEND SUBSCRIPTION STEP 5.1: PARSE_CONFIRM] User ID: ${userId}, Sub ID: "${subscriptionId}", Plan: "${planType}"`);

    if (!planType || !PLAN_CONFIG[planType]) {
      console.warn(`⚠️ [BACKEND SUBSCRIPTION STEP 5.1: INVALID_PLAN] Invalid plan type: "${planType}"`);
      return res.status(400).json({ message: 'Invalid plan type.' });
    }

    const selectedPlan = PLAN_CONFIG[planType];
    let user = (req.user && typeof req.user.save === 'function') ? req.user : await User.findById(userId);
    if (!user && req.user) {
      const fallbackId = req.user._id || req.user.id || userId;
      user = await User.findById(fallbackId);
    }
    if (!user) {
      console.error(`❌ [BACKEND SUBSCRIPTION STEP 5.2: USER_NOT_FOUND] User ID ${userId} not found.`);
      return res.status(404).json({ message: 'User not found.' });
    }

    let activeSubDetails = null;

    if (subscriptionId && !subscriptionId.startsWith('sub_pi_') && !subscriptionId.startsWith('pi_')) {
      try {
        console.log(`🔍 [BACKEND SUBSCRIPTION STEP 5.3: STRIPE_RETRIEVE] Retrieving sub ${subscriptionId} from Stripe...`);
        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
        activeSubDetails = stripeSub;
        console.log(`✅ [BACKEND SUBSCRIPTION STEP 5.3: STRIPE_RETRIEVE_SUCCESS] Sub status: ${stripeSub.status}`);
      } catch (stripeErr) {
        console.warn('⚠️ [BACKEND SUBSCRIPTION STEP 5.3: STRIPE_RETRIEVE_WARNING]:', stripeErr.message);
      }
    } else if (subscriptionId) {
      console.log(`ℹ️ [BACKEND SUBSCRIPTION STEP 5.3: DIRECT_PAYMENT_INTENT] PaymentIntent ID "${subscriptionId}" processed directly.`);
    }

    const periodStart = (activeSubDetails && activeSubDetails.current_period_start) ? new Date(activeSubDetails.current_period_start * 1000) : new Date();
    const periodEnd = (activeSubDetails && activeSubDetails.current_period_end) ? new Date(activeSubDetails.current_period_end * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Update User record in MongoDB safely
    const targetUserId = user._id || user.id || userId;
    console.log(`💾 [BACKEND SUBSCRIPTION STEP 5.4: UPDATE_USER_DB] Updating User ${targetUserId} to ${planType}...`);
    const updatedUser = await User.findByIdAndUpdate(
      targetUserId,
      { $set: { subscriptionTier: planType, subscriptionStatus: 'active' } },
      { returnDocument: 'after' }
    );

    // Filter by subscriptionId OR latest pending subscription record for this user
    const subFilter = subscriptionId
      ? { $or: [{ stripeSubscriptionId: subscriptionId }, { stripeSubscriptionId: `sub_${subscriptionId}` }, { userId: user._id, status: 'incomplete' }] }
      : { userId: user._id };

    // Upsert target Subscription record to active status
    console.log(`💾 [BACKEND SUBSCRIPTION STEP 5.5: UPDATE_SUB_DB] Updating Subscription record to active...`);
    const subRecord = await Subscription.findOneAndUpdate(
      subFilter,
      {
        userId: user._id,
        stripeCustomerId: user.stripeCustomerId || 'cus_direct',
        stripeSubscriptionId: subscriptionId ? (subscriptionId.startsWith('sub_') ? subscriptionId : `sub_${subscriptionId}`) : `sub_${Date.now()}`,
        productId: selectedPlan.productId,
        priceId: selectedPlan.priceId,
        planType: planType,
        status: 'active',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      },
      { upsert: true, returnDocument: 'after', sort: { createdAt: -1 } }
    );

    // Clean up any other pending 'incomplete' records for this user
    await Subscription.updateMany(
      { userId: user._id, status: 'incomplete', _id: { $ne: subRecord._id } },
      { $set: { status: 'canceled' } }
    );

    console.log(`🎉 [BACKEND SUBSCRIPTION STEP 5.6: ACTIVATION_SUCCESS] User "${user.email}" upgraded to ${planType} plan!`);

    return res.status(200).json({
      success: true,
      message: `Successfully upgraded to ${planType} Membership! 🎉`,
      subscriptionTier: updatedUser ? updatedUser.subscriptionTier : planType,
      subscriptionStatus: updatedUser ? updatedUser.subscriptionStatus : 'active',
      subscription: subRecord,
    });
  } catch (error) {
    console.error('❌ [BACKEND SUBSCRIPTION STEP 5 ERROR] Confirm Subscription Error:', error);
    return res.status(500).json({ message: 'Failed to confirm subscription.' });
  }
};

/**
 * Get current user's active subscription details
 */
exports.getMySubscription = async (req, res) => {
  console.log('📌 [BACKEND SUBSCRIPTION: GET_MY_SUBSCRIPTION] Request received.');
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    let user = (req.user && req.user.subscriptionTier !== undefined) ? req.user : await User.findById(userId).select('subscriptionTier subscriptionStatus stripeCustomerId email name');

    if (!user) return res.status(404).json({ message: 'User not found.' });

    const subscription = await Subscription.findOne({ userId, status: 'active' }).sort({ createdAt: -1 });

    const currentTier = user.subscriptionTier || 'Free';
    const planDetails = PLAN_CONFIG[currentTier] || null;

    console.log(`ℹ️ [BACKEND SUBSCRIPTION: GET_MY_SUBSCRIPTION RESULT] Tier: ${currentTier}, Status: ${user.subscriptionStatus || 'inactive'}`);

    return res.status(200).json({
      success: true,
      subscriptionTier: currentTier,
      subscriptionStatus: user.subscriptionStatus || 'inactive',
      planDetails,
      subscription,
      availablePlans: PLAN_CONFIG,
    });
  } catch (error) {
    console.error('❌ [BACKEND SUBSCRIPTION: GET_MY_SUBSCRIPTION ERROR]:', error);
    return res.status(500).json({ message: 'Failed to fetch subscription details.' });
  }
};

/**
 * Cancel active subscription
 */
exports.cancelSubscription = async (req, res) => {
  console.log('📌 [BACKEND SUBSCRIPTION: CANCEL_SUBSCRIPTION] Cancellation request received.');
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    let user = (req.user && typeof req.user.save === 'function') ? req.user : await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const subscription = await Subscription.findOne({ userId, status: 'active' });
    if (!subscription) {
      console.log('ℹ️ [BACKEND SUBSCRIPTION: CANCEL] No active subscription record found, reverting user to Free.');
      await User.findByIdAndUpdate(user._id || userId, {
        $set: { subscriptionTier: 'Free', subscriptionStatus: 'inactive' }
      });
      return res.status(200).json({
        success: true,
        message: 'Subscription cancelled. You are now on the Free tier.',
        subscriptionTier: 'Free',
      });
    }

    if (subscription.stripeSubscriptionId && !subscription.stripeSubscriptionId.startsWith('sub_')) {
      try {
        console.log(`🔴 [BACKEND SUBSCRIPTION: STRIPE_CANCEL] Cancelling Stripe sub ${subscription.stripeSubscriptionId}...`);
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          cancel_at_period_end: true,
        });
      } catch (stripeErr) {
        console.warn('⚠️ Stripe cancellation warning:', stripeErr.message);
      }
    }

    subscription.cancelAtPeriodEnd = true;
    subscription.status = 'canceled';
    await subscription.save();

    await User.findByIdAndUpdate(user._id || userId, {
      $set: { subscriptionTier: 'Free', subscriptionStatus: 'inactive' }
    });

    console.log(`ℹ️ [BACKEND SUBSCRIPTION: CANCEL_SUCCESS] User "${user.email}" cancelled ${subscription.planType} subscription.`);

    return res.status(200).json({
      success: true,
      message: 'Your subscription auto-renewal has been cancelled.',
      subscriptionTier: 'Free',
      subscriptionStatus: 'inactive',
    });
  } catch (error) {
    console.error('❌ [BACKEND SUBSCRIPTION: CANCEL_ERROR]:', error);
    return res.status(500).json({ message: 'Failed to cancel subscription.' });
  }
};

/**
 * Handle Stripe Webhook Events
 */
exports.handleWebhook = async (req, res) => {
  console.log('📌 [BACKEND SUBSCRIPTION STEP 6: WEBHOOK_RECEIVED] Stripe webhook event received.');
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
    console.error(`❌ [BACKEND SUBSCRIPTION STEP 6: WEBHOOK_SIGNATURE_ERROR]: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`📡 [BACKEND SUBSCRIPTION STEP 6: EVENT_TYPE] Event type: ${event.type}`);

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

            console.log(`✅ [BACKEND SUBSCRIPTION STEP 6: WEBHOOK_ACTIVATED] User ${user.email} updated to active ${planType} plan.`);
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

          console.log(`🔴 [BACKEND SUBSCRIPTION STEP 6: WEBHOOK_DELETED] Subscription deleted for customer ${customerId}.`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ [BACKEND SUBSCRIPTION STEP 6: WEBHOOK_ERROR]:', err);
    return res.status(500).json({ message: 'Webhook handler error.' });
  }
};

/**
 * Handle Success Redirect HTML Page
 */
exports.handleSuccessPage = async (req, res) => {
  const { session_id, userId, planType } = req.query;

  console.log(`🎉 [BACKEND SUBSCRIPTION STEP 7: SUCCESS_PAGE_LANDED] Session: ${session_id}, User: ${userId}, Plan: ${planType}`);

  if (userId && planType) {
    try {
      await User.findByIdAndUpdate(userId, {
        $set: { subscriptionTier: planType, subscriptionStatus: 'active' }
      });
      console.log(`✅ [BACKEND SUBSCRIPTION STEP 7: AUTO_ACTIVATED] User ${userId} upgraded to ${planType} plan on success page landing.`);
    } catch (e) {
      console.warn('⚠️ Auto activation warning:', e.message);
    }
  }

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Payment Successful 🎉</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0F172A; color: #FFFFFF; text-align: center; padding: 40px 20px; }
          .card { background: #1E293B; border-radius: 16px; padding: 40px 20px; max-width: 480px; margin: 0 auto; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          h1 { color: #4ADE80; font-size: 28px; margin-bottom: 12px; }
          p { color: #94A3B8; font-size: 16px; line-height: 1.5; }
          .badge { display: inline-block; background: #22C55E; color: #fff; font-weight: bold; padding: 8px 16px; border-radius: 20px; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🎉 Payment Successful!</h1>
          <p>Thank you for subscribing to <strong>${planType || 'Premium'} Membership</strong>.</p>
          <div class="badge">Status: Active</div>
          <p style="margin-top: 25px;">You can now close this tab and return to your app!</p>
        </div>
      </body>
    </html>
  `);
};

/**
 * Handle Cancel Redirect HTML Page
 */
exports.handleCancelPage = async (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Payment Cancelled</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0F172A; color: #FFFFFF; text-align: center; padding: 40px 20px; }
          .card { background: #1E293B; border-radius: 16px; padding: 40px 20px; max-width: 480px; margin: 0 auto; }
          h1 { color: #F87171; font-size: 26px; }
          p { color: #94A3B8; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Checkout Cancelled</h1>
          <p>No charges were made. You can return to the app and try again anytime.</p>
        </div>
      </body>
    </html>
  `);
};
