const User = require('../models/User');

const FREE_SWIPE_LIMIT = 10;
const GOLD_SUPER_LIKE_LIMIT = 5;
const PREMIUM_SUPER_LIKE_LIMIT = 10;

/**
 * Middleware: Enforce Daily Swipe Limits for Free Tier Users
 */
exports.checkSwipeLimit = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user;
    let user = (req.user && typeof req.user.save === 'function') ? req.user : await User.findById(userId);

    if (!user) {
      return res.status(400).json({ message: 'User not found.' });
    }

    const tier = user.subscriptionTier || 'Free';

    // Gold and Premium tiers have Unlimited Swipes
    if (tier === 'Gold' || tier === 'Premium') {
      return next();
    }

    // Free Tier: Reset counter if last reset was more than 24 hours ago
    const now = new Date();
    const lastReset = user.lastSwipeReset ? new Date(user.lastSwipeReset) : new Date(0);
    const hoursPassed = (now - lastReset) / (1000 * 60 * 60);

    if (hoursPassed >= 24) {
      user.dailySwipeCount = 0;
      user.lastSwipeReset = now;
    }

    if (user.dailySwipeCount >= FREE_SWIPE_LIMIT) {
      return res.status(403).json({
        success: false,
        code: 'SWIPE_LIMIT_EXCEEDED',
        message: 'Daily swipe limit reached! Upgrade to Gold or Premium for Unlimited Swipes.',
        limit: FREE_SWIPE_LIMIT,
        dailySwipeCount: user.dailySwipeCount,
      });
    }

    // Increment swipe count for Free user
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
  const tier = req.user?.subscriptionTier || 'Free';
  if (tier === 'Free') {
    return res.status(403).json({
      success: false,
      code: 'PASSPORT_LOCKED',
      message: 'Passport location change is exclusive to Gold & Premium members.',
    });
  }
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

    const tier = user.subscriptionTier || 'Free';
    const limit = tier === 'Premium' ? PREMIUM_SUPER_LIKE_LIMIT : (tier === 'Gold' ? GOLD_SUPER_LIKE_LIMIT : 0);

    if (limit === 0) {
      return res.status(403).json({
        success: false,
        code: 'SUPER_LIKE_LOCKED',
        message: 'Super Likes are exclusive to Gold & Premium subscribers.',
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
        message: `Daily Super Like limit of ${limit} reached! Try again tomorrow.`,
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
