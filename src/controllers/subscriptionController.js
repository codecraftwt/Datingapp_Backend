const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const { getUserPlanPermissions } = require('../middleware/featureAccess');

const PLAN_CONFIG = {
  Gold: {
    productId: process.env.STRIPE_GOLD_PRODUCT_ID || 'prod_VJ21gIU9Hsv76n',
    priceId: process.env.STRIPE_GOLD_PRICE_ID || 'price_1UIPxoSNVBh57Ub94bpA7rtZ',
    name: 'Gold Membership',
    tier: 'Gold',
    priceAmount: '$9',
    priceDisplay: '$9 / month',
    features: [
      'Unlimited Likes & Swipes',
      'See Who Liked Your Profile',
      '5 Super Likes per day',
    ]
  },
  Premium: {
    productId: process.env.STRIPE_PREMIUM_PRODUCT_ID || 'prod_VJ211jsXBEFLpr',
    priceId: process.env.STRIPE_PREMIUM_PRICE_ID || 'price_1UIPxESNVBh57Ub9JgqAyuuy',
    name: 'Premium Membership',
    tier: 'Premium',
    priceAmount: '$5',
    priceDisplay: '$5 / month',
    features: [
      '3 Likes per day',
      '1 Super Like per day',
      'See Who Liked Your Profile',
      '1 Free Monthly Profile Boost',
      'Unlock All Advanced Search Filters',
    ],
  },
};

/**
 * Get available subscription plans configuration (Dynamic from MongoDB)
 */
exports.getSubscriptionPlans = async (req, res) => {
  console.log('📌 [BACKEND SUBSCRIPTION STEP 1: GET_PLANS] Fetching available subscription plans & Stripe publishable key...');
  try {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51UIPtESNVBh57Ub9dg7BgWRA8KgUvVfkFtyov0Etl0OCG3Uh3Xjrj39wr5C3FhO60Zes39Ioi9kDAROGYP3PPqpD00oCTzeHvY';

    // Fetch all plans from MongoDB Plan collection (active and archived)
    const dbPlans = await Plan.find({}).sort({ displayOrder: 1, price: 1 });

    const finalPlans = { ...PLAN_CONFIG };
    const dynamicPlansList = [];

    if (dbPlans && dbPlans.length > 0) {
      dbPlans.forEach((p) => {
        const featureDescriptions = [];
        p.features?.forEach((f) => {
          if (f.isAllowed) {
            if (f.featureKey === 'SWIPES') {
              featureDescriptions.push(f.limitValue === -1 ? 'Unlimited Likes & Swipes' : `${f.limitValue} Likes per day`);
            } else if (f.featureKey === 'SUPER_LIKES') {
              if (f.limitValue > 0) featureDescriptions.push(`${f.limitValue} Super Likes per day`);
            } else if (f.featureKey === 'SEE_WHO_LIKED_YOU') {
              featureDescriptions.push('See Who Liked Your Profile');
            } else if (f.featureKey === 'ADVANCED_SEARCH') {
              featureDescriptions.push('Unlock All Advanced Search Filters');
            } else if (f.featureKey === 'PROFILE_BOOST') {
              if (f.limitValue > 0) featureDescriptions.push('1 Free Monthly Profile Boost');
            } else {
              featureDescriptions.push(f.featureKey.replace(/_/g, ' '));
            }
          }
        });

        const formattedPlan = {
          _id: p._id,
          productId: p.stripeProductId || (PLAN_CONFIG[p.planKey]?.productId) || '',
          priceId: p.stripePriceId || (PLAN_CONFIG[p.planKey]?.priceId) || '',
          name: p.name,
          tier: p.planKey,
          planKey: p.planKey,
          price: p.price,
          currency: p.currency || 'USD',
          billingCycle: p.billingCycle || 'monthly',
          priceAmount: `$${p.price}`,
          priceDisplay: `$${p.price} / ${p.billingCycle || 'month'}`,
          features: featureDescriptions,
          rawFeatures: p.features || [],
          highlightBadge: p.highlightBadge || '',
          description: p.description || '',
          isActive: p.isActive !== false,
        };

        finalPlans[p.planKey] = formattedPlan;
        dynamicPlansList.push(formattedPlan);
      });
    }

    console.log('✅ [BACKEND SUBSCRIPTION STEP 1: GET_PLANS SUCCESS] Returning dynamic plans:', Object.keys(finalPlans));
    return res.status(200).json({
      success: true,
      publishableKey,
      plans: finalPlans,
      plansList: dynamicPlansList,
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

    // Lookup plan dynamically from MongoDB Plan collection or fallback to PLAN_CONFIG
    let dbPlan = await Plan.findOne({ planKey: planType });
    if (!dbPlan && !PLAN_CONFIG[planType]) {
      console.warn(`⚠️ [BACKEND SUBSCRIPTION STEP 2.1: INVALID_PLAN] Invalid plan type requested: "${planType}"`);
      return res.status(400).json({ message: `Invalid plan type: "${planType}".` });
    }

    const planName = dbPlan ? dbPlan.name : (PLAN_CONFIG[planType]?.name || planType);
    const rawPrice = dbPlan ? dbPlan.price : (planType === 'Gold' ? 9.99 : 4.99);
    const amountCents = Math.round(parseFloat(rawPrice) * 100);
    const planCurrency = (dbPlan?.currency || 'USD').toLowerCase();
    const selectedPlan = dbPlan ? {
      productId: dbPlan.stripeProductId || (PLAN_CONFIG[planType]?.productId) || '',
      priceId: dbPlan.stripePriceId || (PLAN_CONFIG[planType]?.priceId) || '',
      name: dbPlan.name,
      tier: dbPlan.planKey,
      priceAmount: `$${dbPlan.price}`,
      priceDisplay: `$${dbPlan.price} / ${dbPlan.billingCycle || 'month'}`,
      currency: dbPlan.currency || 'USD',
      planKey: dbPlan.planKey,
    } : PLAN_CONFIG[planType];

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

    // Get or create Stripe Customer dynamically
    let customerId = user.stripeCustomerId;

    if (customerId) {
      console.log(`ℹ️ [BACKEND SUBSCRIPTION STEP 3: STRIPE_CUSTOMER_EXISTING] Customer ID found in DB: ${customerId}. Verifying in active Stripe account...`);
      try {
        await stripe.customers.retrieve(customerId);
        console.log(`✅ [BACKEND SUBSCRIPTION STEP 3: STRIPE_CUSTOMER_UPDATED] Customer ${customerId} validated.`);
      } catch (custErr) {
        console.warn(`⚠️ [STRIPE CUSTOMER] Stale/Invalid Customer ID '${customerId}' for user ${user.email}: ${custErr.message}. Resetting...`);
        customerId = null;
        user.stripeCustomerId = null;
      }
    }

    if (!customerId) {
      const userEmail = user.email || (user._id ? `${user._id}@datingapp.com` : 'user@datingapp.com');
      const userName = user.name || user.firstName || (user.email && typeof user.email === 'string' && user.email.includes('@') ? user.email.split('@')[0] : 'User');
      console.log(`👤 [BACKEND SUBSCRIPTION STEP 3: STRIPE_CUSTOMER_CREATE] Creating fresh Stripe customer for ${userEmail}...`);
      const customer = await stripe.customers.create({
        email: userEmail,
        name: userName,
        metadata: { userId: (userId || '').toString() },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      if (typeof user.save === 'function') {
        await user.save();
      }
      console.log(`✅ [BACKEND SUBSCRIPTION STEP 3: STRIPE_CUSTOMER_CREATED] New Customer ID created: ${customerId}`);
    }

    // Define reliable backend success/cancel URLs for Checkout session completion
    // Support Live Production Base URL or dynamic request host
    const host = req.get('host') || 'localhost:5000';
    let protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    if (host.includes('vercel.app') || host.includes('herokuapp.com') || host.includes('render.com') || host.includes('railway.app') || host.includes('.com') || host.includes('.app')) {
      protocol = 'https';
    }

    // Use PUBLIC_API_URL if defined in .env, otherwise build from request host
    let baseApiUrl = process.env.PUBLIC_API_URL;
    if (!baseApiUrl) {
      if (protocol === 'http' && !host.includes('localhost') && !host.includes('127.0.0.1')) {
        const port = host.includes(':') ? host.split(':')[1] : '5000';
        baseApiUrl = `http://localhost:${port}`;
      } else {
        baseApiUrl = `${protocol}://${host}`;
      }
    }

    let successUrl = `${baseApiUrl}/api/subscriptions/success-page?session_id={CHECKOUT_SESSION_ID}&userId=${userId}&planType=${planType}`;
    let cancelUrl = `${baseApiUrl}/api/subscriptions/cancel-page`;

    console.log(`📌 [BACKEND SUBSCRIPTION STEP 4: URLS_GENERATED] Base: ${baseApiUrl}, Success: ${successUrl}`);

    // Create standard Stripe Hosted Checkout Session (displays full card number, expiry, CVC entry UI)
    let targetCheckoutUrl = '';
    let subId = `sub_${Date.now()}`;
    let sessionId = `cs_${Date.now()}`;

    try {
      console.log(`🔄 [BACKEND SUBSCRIPTION STEP 4.1: STRIPE_CHECKOUT_SESSION] Creating clean hosted checkout page for ${planName}...`);
      // Stripe Checkout session payload configured for dynamic price & currency (USD)
      const sessionPayload = {
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: planCurrency || 'usd',
              product_data: {
                name: `${planName}`,
                description: `1-Month ${planName} Membership`,
              },
              unit_amount: amountCents,
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

      let checkoutSession;
      try {
        checkoutSession = await stripe.checkout.sessions.create(sessionPayload);
      } catch (sessErr) {
        if (sessErr.message && sessErr.message.includes('No such customer')) {
          console.warn(`⚠️ [STRIPE CHECKOUT] Customer ${customerId} rejected by Stripe. Creating new customer and retrying...`);
          const userEmail = user.email || `${user._id}@datingapp.com`;
          const userName = user.name || 'User';
          const freshCustomer = await stripe.customers.create({
            email: userEmail,
            name: userName,
            metadata: { userId: (userId || '').toString() },
          });
          customerId = freshCustomer.id;
          user.stripeCustomerId = customerId;
          if (typeof user.save === 'function') await user.save();
          sessionPayload.customer = customerId;
          checkoutSession = await stripe.checkout.sessions.create(sessionPayload);
        } else {
          throw sessErr;
        }
      }

      targetCheckoutUrl = checkoutSession.url;
      subId = checkoutSession.subscription || `sub_${checkoutSession.id}`;
      sessionId = checkoutSession.id;
      console.log(`✅ [BACKEND SUBSCRIPTION STEP 4.2: CHECKOUT_SESSION_SUCCESS] Hosted Checkout URL: ${targetCheckoutUrl}`);
    } catch (stripeErr) {
      console.error('❌ [BACKEND SUBSCRIPTION STEP 4.3: CHECKOUT_SESSION_ERROR]:', stripeErr.message);
      return res.status(500).json({ message: 'Failed to create payment session: ' + stripeErr.message });
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
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51UIPtESNVBh57Ub9dg7BgWRA8KgUvVfkFtyov0Etl0OCG3Uh3Xjrj39wr5C3FhO60Zes39Ioi9kDAROGYP3PPqpD00oCTzeHvY',
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

    // Validate plan type against DB or PLAN_CONFIG
    let dbPlan = await Plan.findOne({ planKey: planType });
    if (!planType || (!dbPlan && !PLAN_CONFIG[planType])) {
      console.warn(`⚠️ [BACKEND SUBSCRIPTION STEP 5.1: INVALID_PLAN] Invalid plan type: "${planType}"`);
      return res.status(400).json({ message: 'Invalid plan type.' });
    }

    const selectedPlan = dbPlan ? {
      name: dbPlan.name,
      tier: dbPlan.planKey,
      priceAmount: `$${dbPlan.price}`,
    } : PLAN_CONFIG[planType];
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

    const permissions = await getUserPlanPermissions(planType);

    return res.status(200).json({
      success: true,
      message: `Successfully upgraded to ${planType} Membership! 🎉`,
      subscriptionTier: updatedUser ? updatedUser.subscriptionTier : planType,
      subscriptionStatus: updatedUser ? updatedUser.subscriptionStatus : 'active',
      permissions,
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
    let user = (req.user && req.user.subscriptionTier !== undefined) ? req.user : await User.findById(userId).select('subscriptionTier subscriptionStatus stripeCustomerId email name dailySwipeCount dailySuperLikesCount');

    if (!user) return res.status(404).json({ message: 'User not found.' });

    let currentTier = user.subscriptionTier || 'Free';

    // Auto-check if active subscription period has expired past 30 days
    if (currentTier !== 'Free') {
      const activeSub = await Subscription.findOne({ userId, status: 'active' }).sort({ createdAt: -1 });
      if (activeSub && activeSub.currentPeriodEnd && new Date(activeSub.currentPeriodEnd) < new Date()) {
        console.log(`⏱️ [SUBSCRIPTION EXPIRY] Current period ended for User ${userId}. Reverting to Free tier.`);
        activeSub.status = 'canceled';
        await activeSub.save();
        await User.findByIdAndUpdate(userId, {
          $set: { subscriptionTier: 'Free', subscriptionStatus: 'inactive' }
        });
        currentTier = 'Free';
        user.subscriptionTier = 'Free';
        user.subscriptionStatus = 'inactive';
      }
    }

    const isFree = !currentTier || currentTier.toLowerCase() === 'free' || currentTier.toLowerCase() === 'inactive';
    const cleanTier = currentTier.replace(/plan/i, '').trim();

    let dbPlan = await Plan.findOne({
      $or: [
        { planKey: { $regex: new RegExp(`^${currentTier}$`, 'i') } },
        { name: { $regex: new RegExp(`^${currentTier}$`, 'i') } },
        { planKey: { $regex: new RegExp(`^${cleanTier}`, 'i') } },
        { name: { $regex: new RegExp(`^${cleanTier}`, 'i') } },
      ],
      isActive: true,
    });
    if (!dbPlan && !isFree) {
      dbPlan = await Plan.findOne({
        $or: [
          { planKey: { $regex: new RegExp(`^${currentTier}$`, 'i') } },
          { name: { $regex: new RegExp(`^${currentTier}$`, 'i') } },
          { planKey: { $regex: new RegExp(`^${cleanTier}`, 'i') } },
          { name: { $regex: new RegExp(`^${cleanTier}`, 'i') } },
        ],
      });
    }

    // Dynamically obtain permissions from MongoDB Plan collection
    const permissions = await getUserPlanPermissions(currentTier);

    let featureList = [];
    if (dbPlan && Array.isArray(dbPlan.features)) {
      dbPlan.features.forEach((f) => {
        if (!f.isAllowed) return;
        const featKey = (f.featureKey || '').toUpperCase();
        if (featKey === 'SWIPES') {
          featureList.push(f.limitValue === -1 ? 'Unlimited Likes & Swipes' : `${f.limitValue} Swipes per day`);
        } else if (featKey === 'SUPER_LIKES') {
          if (f.limitValue > 0) {
            featureList.push(`${f.limitValue} Super Likes per day`);
          }
        } else if (featKey === 'ADVANCED_SEARCH' || featKey === 'SEARCH') {
          featureList.push('Unlock All Advanced Search Filters');
        } else if (featKey === 'SEE_WHO_LIKED_YOU' || featKey === 'LIKES') {
          featureList.push('See Who Liked Your Profile');
        } else {
          featureList.push(f.featureName || f.featureKey);
        }
      });
    }

    if (featureList.length === 0) {
      if (permissions.swipes?.isAllowed) {
        featureList.push(permissions.swipes.isUnlimited ? 'Unlimited Likes & Swipes' : `${permissions.swipes.limitValue} Swipes per day`);
      }
      if (permissions.superLikes?.isAllowed && permissions.superLikes.limitValue > 0) {
        featureList.push(`${permissions.superLikes.limitValue} Super Likes per day`);
      }
      if (permissions.search?.isAllowed) {
        featureList.push('Unlock All Advanced Search Filters');
      }
      if (permissions.likes?.isAllowed) {
        featureList.push('See Who Liked Your Profile');
      }
    }

    const subscription = await Subscription.findOne({ userId, status: 'active' }).sort({ createdAt: -1 });

    console.log(`ℹ️ [BACKEND SUBSCRIPTION: GET_MY_SUBSCRIPTION RESULT] Tier: ${currentTier}, Search: ${permissions.search.isAllowed}, Likes: ${permissions.likes.isAllowed}, Swipes: ${permissions.swipes.isUnlimited ? 'Unlimited' : permissions.swipes.limitValue}, SuperLikes: ${permissions.superLikes.limitValue}`);

    return res.status(200).json({
      success: true,
      subscriptionTier: currentTier,
      subscriptionStatus: user.subscriptionStatus || 'inactive',
      permissions,
      features: featureList,
      plan: dbPlan ? {
        name: dbPlan.name,
        planKey: dbPlan.planKey,
        price: dbPlan.price,
        currency: dbPlan.currency,
        features: featureList,
      } : null,
      subscription,
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
            if (priceId === (process.env.STRIPE_PREMIUM_PRICE_ID || 'price_1UIPxESNVBh57Ub9JgqAyuuy')) {
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

  console.log(`🎉 [BACKEND SUBSCRIPTION: SUCCESS_PAGE_LANDED] Session: ${session_id}, User: ${userId}, Plan: ${planType}`);

  if (userId && planType) {
    try {
      await User.findByIdAndUpdate(userId, {
        $set: { subscriptionTier: planType, subscriptionStatus: 'active' }
      });
      console.log(`✅ [BACKEND SUBSCRIPTION: AUTO_ACTIVATED] User ${userId} upgraded to ${planType} plan on success page landing.`);
    } catch (e) {
      console.warn('⚠️ Auto activation warning:', e.message);
    }
  }

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Payment Successful 🎉</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background: #0B0E14;
            color: #FFFFFF;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
          }
          .header-bar {
            width: 100%;
            padding: 16px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(21, 26, 35, 0.8);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            position: sticky;
            top: 0;
            z-index: 100;
          }
          .header-back-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(255, 255, 255, 0.08);
            color: #FFFFFF;
            font-size: 14px;
            font-weight: 700;
            padding: 10px 18px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            cursor: pointer;
            text-decoration: none;
            transition: all 0.2s ease;
          }
          .header-back-btn:active {
            background: rgba(255, 255, 255, 0.18);
            transform: scale(0.96);
          }
          .main-content {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            width: 100%;
          }
          .card {
            background: #151A23;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 28px;
            padding: 44px 28px;
            max-width: 440px;
            width: 100%;
            text-align: center;
            box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6);
            animation: fadeIn 0.4s ease-out;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .icon-wrapper {
            width: 80px;
            height: 80px;
            background: rgba(34, 197, 94, 0.15);
            border: 2px solid #22C55E;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px auto;
            color: #22C55E;
            font-size: 40px;
            font-weight: bold;
          }
          h1 {
            color: #FFFFFF;
            font-size: 26px;
            font-weight: 800;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
          }
          .plan-badge {
            display: inline-block;
            background: linear-gradient(135deg, #FE3C72, #FF655B);
            color: #FFFFFF;
            font-weight: 700;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1px;
            padding: 6px 16px;
            border-radius: 20px;
            margin-bottom: 16px;
          }
          p.desc {
            color: #94A3B8;
            font-size: 15px;
            line-height: 1.6;
            margin-bottom: 32px;
          }
          .back-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            width: 100%;
            background: linear-gradient(135deg, #FE3C72, #FF655B);
            color: #FFFFFF;
            font-size: 17px;
            font-weight: 700;
            text-decoration: none;
            padding: 16px;
            border-radius: 16px;
            border: none;
            cursor: pointer;
            box-shadow: 0 10px 25px rgba(254, 60, 114, 0.4);
            transition: all 0.2s ease;
          }
          .back-btn:active {
            transform: scale(0.98);
            opacity: 0.9;
          }
        </style>
      </head>
      <body>
        <div class="header-bar">
          <button class="header-back-btn" onclick="backToApp()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            <span>Back to App</span>
          </button>
        </div>

        <div class="main-content">
          <div class="card">
            <div class="icon-wrapper">✓</div>
            <div class="plan-badge">${planType || 'Premium'} Plan</div>
            <h1>Payment Successful!</h1>
            <p class="desc">
              Your subscription has been activated successfully! All features included in your plan are now unlocked. Tapping below returns to the app.
            </p>
            <button class="back-btn" onclick="backToApp()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              <span>Return to App</span>
            </button>
          </div>
        </div>

        <script>
          function backToApp() {
            try {
              if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'BACK_TO_APP' }));
              }
            } catch(e) {}
            window.location.href = '/api/subscriptions/back-to-app';
          }
        </script>
      </body>
    </html>
  `);
};

exports.handleBackToApp = async (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script>
          try {
            if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'BACK_TO_APP' }));
            }
          } catch(e) {}
          setTimeout(function() {
            window.location.href = 'datingapp://';
          }, 300);
        </script>
      </head>
      <body style="background:#0B0E14;color:#FFF;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:50px 20px;">
        <h2>Redirecting to App...</h2>
        <p style="color:#94A3B8;margin-top:10px;">You may safely close this window to return to the app.</p>
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

/**
 * Real-time Status Inspector Endpoint
 */
exports.checkSessionStatus = async (req, res) => {
  try {
    const { sessionId } = req.query;
    console.log(`🔍 [BACKEND STATUS CHECK] Inspecting session ${sessionId}...`);

    let session = null;
    let paymentIntent = null;

    if (sessionId && sessionId.startsWith('cs_')) {
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId, {
          expand: ['payment_intent'],
        });
        if (session.payment_intent && typeof session.payment_intent === 'object') {
          paymentIntent = session.payment_intent;
        }
      } catch (sErr) {
        console.warn('⚠️ Could not retrieve session:', sErr.message);
      }
    } else if (sessionId && (sessionId.startsWith('pi_') || sessionId.startsWith('sub_pi_'))) {
      const piId = sessionId.replace('sub_', '');
      try {
        paymentIntent = await stripe.paymentIntents.retrieve(piId);
      } catch (piErr) {
        console.warn('⚠️ Could not retrieve payment intent:', piErr.message);
      }
    }

    const lastError = paymentIntent?.last_payment_error?.message || null;
    const piStatus = paymentIntent?.status || 'unknown';
    const paymentStatus = session?.payment_status || (piStatus === 'succeeded' ? 'paid' : 'unpaid');

    console.log(`📊 [BACKEND STATUS CHECK RESULT] Payment Status: ${paymentStatus}, PI Status: ${piStatus}, Error: "${lastError || 'None'}"`);

    return res.status(200).json({
      success: true,
      sessionStatus: session?.status || 'open',
      paymentStatus: paymentStatus,
      piStatus: piStatus,
      lastError: lastError,
      message: lastError ? `Stripe Error: ${lastError}` : `Session status: ${paymentStatus}`,
    });
  } catch (error) {
    console.error('❌ [BACKEND STATUS CHECK ERROR]:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};
