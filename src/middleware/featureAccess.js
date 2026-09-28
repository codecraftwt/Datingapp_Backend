const User = require('../models/User');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');

// Default fallback limit for users without custom plan configuration
const FREE_SWIPE_LIMIT = 2;

/**
 * Helper: verify if active subscription has passed its expiration date.
 * If expired, automatically downgrade user to Free tier and inactive status in DB.
 */
async function getEffectiveTier(user) {
  let tier = user.subscriptionTier || 'Free';
  if (tier !== 'Free') {
    try {
      const activeSub = await Subscription.findOne({ userId: user._id || user.id, status: 'active' }).sort({ createdAt: -1 });
      if (activeSub && activeSub.currentPeriodEnd && new Date(activeSub.currentPeriodEnd) < new Date()) {
        console.log(`⏱️ [SUBSCRIPTION EXPIRY] Current period ended for user ${user._id}. Reverting to Free tier.`);
        activeSub.status = 'canceled';
        await activeSub.save();
        await User.findByIdAndUpdate(user._id || user.id, {
          $set: { subscriptionTier: 'Free', subscriptionStatus: 'inactive' }
        });
        user.subscriptionTier = 'Free';
        user.subscriptionStatus = 'inactive';
        tier = 'Free';
      }
    } catch (e) {
      console.warn('⚠️ Error checking subscription expiry:', e.message);
    }
  }
  return tier;
}

/**
 * Helper: Dynamically fetch feature permissions from MongoDB Plan collection for a tier
 */
exports.getUserPlanPermissions = async (tier) => {
  const currentTier = tier || 'Free';
  const cleanTier = currentTier.replace(/plan/i, '').trim();

  // Try to find the exact Plan document from MongoDB
  const plan = await Plan.findOne({
    $or: [
      { planKey: { $regex: new RegExp(`^${currentTier}$`, 'i') } },
      { name: { $regex: new RegExp(`^${currentTier}$`, 'i') } },
      { planKey: { $regex: new RegExp(`^${cleanTier}`, 'i') } },
      { name: { $regex: new RegExp(`^${cleanTier}`, 'i') } },
    ],
    isActive: true,
  }) || await Plan.findOne({
    $or: [
      { planKey: { $regex: new RegExp(`^${currentTier}$`, 'i') } },
      { name: { $regex: new RegExp(`^${currentTier}$`, 'i') } },
      { planKey: { $regex: new RegExp(`^${cleanTier}`, 'i') } },
      { name: { $regex: new RegExp(`^${cleanTier}`, 'i') } },
    ],
  });

  // Default baseline for Free tier if no custom plan is defined
  const permissions = {
    swipes: { isAllowed: true, limitValue: 2, isUnlimited: false },
    superLikes: { isAllowed: false, limitValue: 0 },
    search: { isAllowed: false },
    likes: { isAllowed: false },
  };

  // If a plan exists in MongoDB, extract ALL permissions DYNAMICALLY from its features array!
  if (plan && Array.isArray(plan.features)) {
    plan.features.forEach((f) => {
      const featKey = (f.featureKey || '').toUpperCase();
      const isAllowed = Boolean(f.isAllowed);
      const limitVal = typeof f.limitValue === 'number' ? f.limitValue : (isAllowed ? -1 : 0);

      if (featKey === 'SWIPES') {
        permissions.swipes = {
          isAllowed: isAllowed,
          limitValue: limitVal,
          isUnlimited: limitVal === -1,
        };
      } else if (featKey === 'SUPER_LIKES') {
        permissions.superLikes = {
          isAllowed: isAllowed && limitVal !== 0,
          limitValue: Math.max(0, limitVal),
        };
      } else if (featKey === 'ADVANCED_SEARCH' || featKey === 'SEARCH') {
        permissions.search = {
          isAllowed: isAllowed,
        };
      } else if (featKey === 'SEE_WHO_LIKED_YOU' || featKey === 'LIKES') {
        permissions.likes = {
          isAllowed: isAllowed,
        };
      } else {
        permissions[f.featureKey.toLowerCase()] = {
          isAllowed: isAllowed,
          limitValue: limitVal,
        };
      }
    });
  }

  return permissions;
};

/**
 * Middleware: Enforce Daily Swipe Limits for Users (Dynamic by Plan saved in MongoDB)
 */
exports.checkSwipeLimit = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    let user = (req.user && typeof req.user.save === 'function') ? req.user : await User.findById(userId);

    if (!user) {
      return res.status(400).json({ message: 'User not found.' });
    }

    const tier = await getEffectiveTier(user);
    const perms = await exports.getUserPlanPermissions(tier);

    if (!perms.swipes.isAllowed) {
      return res.status(403).json({
        success: false,
        code: 'SWIPE_LOCKED',
        message: 'Likes & Swipes are locked for your plan. Please upgrade to swipe!',
      });
    }

    if (perms.swipes.isUnlimited) {
      return next();
    }

    const limit = typeof perms.swipes.limitValue === 'number' && perms.swipes.limitValue >= 0 ? perms.swipes.limitValue : FREE_SWIPE_LIMIT;

    // Reset counter if last reset was more than 24 hours ago
    const now = new Date();
    const lastReset = user.lastSwipeReset ? new Date(user.lastSwipeReset) : new Date(0);
    const hoursPassed = (now - lastReset) / (1000 * 60 * 60);

    if (hoursPassed >= 24) {
      user.dailySwipeCount = 0;
      user.lastSwipeReset = now;
    }

    if (user.dailySwipeCount >= limit) {
      return res.status(403).json({
        success: false,
        code: 'SWIPE_LIMIT_EXCEEDED',
        message: `Daily swipe limit of ${limit} reached! Upgrade for Unlimited Swipes.`,
        limit: limit,
        dailySwipeCount: user.dailySwipeCount,
      });
    }

    // Increment swipe count
    user.dailySwipeCount = (user.dailySwipeCount || 0) + 1;
    await User.findByIdAndUpdate(user._id || userId, {
      $set: {
        dailySwipeCount: user.dailySwipeCount,
        lastSwipeReset: user.lastSwipeReset,
      },
    });

    next();
  } catch (error) {
    console.error('[FEATURE ACCESS] Error checking swipe limit:', error);
    next();
  }
};

/**
 * Helper: Check Passport (Location Change) Access
 */
exports.checkPassportAccess = (req, res, next) => {
  // Passport location restriction disabled for subscription
  next();
};

/**
 * Helper: Check Super Like Access (Dynamic by Plan saved in MongoDB)
 */
exports.checkSuperLikeLimit = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    let user = (req.user && typeof req.user.save === 'function') ? req.user : await User.findById(userId);

    if (!user) return res.status(404).json({ message: 'User not found.' });

    const tier = await getEffectiveTier(user);
    const perms = await exports.getUserPlanPermissions(tier);

    const limit = perms.superLikes.isAllowed ? (perms.superLikes.limitValue || 0) : 0;

    if (limit === 0) {
      return res.status(403).json({
        success: false,
        code: 'SUPER_LIKE_LOCKED',
        message: 'Super Likes are exclusive to subscribed members. Upgrade to get daily Super Likes!',
      });
    }

    const now = new Date();
    const lastReset = user.lastSuperLikeReset ? new Date(user.lastSuperLikeReset) : new Date(0);
    const hoursPassed = (now - lastReset) / (1000 * 60 * 60);

    if (hoursPassed >= 24) {
      user.dailySuperLikesCount = 0;
      user.lastSuperLikeReset = now;
    }

    if (user.dailySuperLikesCount >= limit) {
      return res.status(403).json({
        success: false,
        code: 'SUPER_LIKE_LIMIT_EXCEEDED',
        message: 'Your super likes limit have reached',
        limit: limit,
        dailySuperLikesCount: user.dailySuperLikesCount,
      });
    }

    user.dailySuperLikesCount = (user.dailySuperLikesCount || 0) + 1;
    await User.findByIdAndUpdate(user._id || userId, {
      $set: {
        dailySuperLikesCount: user.dailySuperLikesCount,
        lastSuperLikeReset: user.lastSuperLikeReset,
      },
    });

    next();
  } catch (error) {
    console.error('[FEATURE ACCESS] Error checking super like limit:', error);
    next();
  }
};

/**
 * Middleware: Enforce Advanced Search Access (Dynamic by Plan saved in MongoDB)
 */
exports.checkSearchAccess = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    let user = (req.user && typeof req.user.save === 'function') ? req.user : await User.findById(userId);

    if (!user) return res.status(400).json({ message: 'User not found.' });

    const tier = await getEffectiveTier(user);
    const perms = await exports.getUserPlanPermissions(tier);

    if (!perms.search.isAllowed) {
      return res.status(403).json({
        success: false,
        code: 'SEARCH_LOCKED',
        message: 'Advanced Search Filters are exclusive to subscribed members. Upgrade your plan to unlock Search!',
      });
    }

    next();
  } catch (error) {
    console.error('[FEATURE ACCESS] Error checking search access:', error);
    next();
  }
};


