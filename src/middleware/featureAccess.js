const User = require('../models/User');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');

// Default fallback limits
const FREE_SWIPE_LIMIT = 2;
const PREMIUM_SWIPE_LIMIT = 3;
const GOLD_SUPER_LIKE_LIMIT = 5;
const PREMIUM_SUPER_LIKE_LIMIT = 1;

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
 * Middleware: Enforce Daily Swipe Limits for Users (Dynamic by Plan)
 */
exports.checkSwipeLimit = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    let user = (req.user && typeof req.user.save === 'function') ? req.user : await User.findById(userId);

    if (!user) {
      return res.status(400).json({ message: 'User not found.' });
    }

    const tier = await getEffectiveTier(user);

    let limit = FREE_SWIPE_LIMIT;
    let isUnlimited = false;

    if (tier !== 'Free') {
      try {
        const plan = await Plan.findOne({ planKey: tier, isActive: true });
        if (plan) {
          const swipeFeat = plan.features?.find((f) => f.featureKey === 'SWIPES');
          if (swipeFeat) {
            if (swipeFeat.limitValue === -1) {
              isUnlimited = true;
            } else {
              limit = swipeFeat.limitValue;
            }
          }
        } else if (tier === 'Gold') {
          isUnlimited = true;
        } else if (tier === 'Premium') {
          limit = PREMIUM_SWIPE_LIMIT;
        }
      } catch (e) {
        if (tier === 'Gold') isUnlimited = true;
      }
    }

    // Unlimited Swipes allowed for this plan
    if (isUnlimited) {
      return next();
    }

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

    // Increment swipe count for Free and Premium users
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
 * Helper: Check Super Like Access
 */
exports.checkSuperLikeLimit = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    let user = (req.user && typeof req.user.save === 'function') ? req.user : await User.findById(userId);

    if (!user) return res.status(404).json({ message: 'User not found.' });

    const tier = await getEffectiveTier(user);
    let limit = 0;

    if (tier !== 'Free') {
      try {
        const plan = await Plan.findOne({ planKey: tier, isActive: true });
        if (plan) {
          const slFeat = plan.features?.find((f) => f.featureKey === 'SUPER_LIKES');
          if (slFeat && slFeat.isAllowed) {
            limit = slFeat.limitValue || 0;
          }
        } else if (tier === 'Gold') {
          limit = GOLD_SUPER_LIKE_LIMIT;
        } else if (tier === 'Premium') {
          limit = PREMIUM_SUPER_LIKE_LIMIT;
        }
      } catch (e) {
        limit = tier === 'Gold' ? GOLD_SUPER_LIKE_LIMIT : (tier === 'Premium' ? PREMIUM_SUPER_LIKE_LIMIT : 0);
      }
    }

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

