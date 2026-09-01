const Match = require('../models/Match');
const User = require('../models/User');
const Message = require('../models/Message');
const Block = require('../models/Block');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const { sendPushNotification } = require('../services/pushNotificationService');

/**
 * Helper to check if a user is currently online (ONLY if user has live socket connection inside app)
 */
const checkIsOnline = (user) => {
  if (!user) return false;
  const uIdStr = (user._id || user.id || user).toString();
  if (global.onlineUsers && global.onlineUsers.has(uIdStr)) return true;
  if (global.io && global.io.sockets && global.io.sockets.adapter && global.io.sockets.adapter.rooms.has(uIdStr)) {
    const rm = global.io.sockets.adapter.rooms.get(uIdStr);
    if (rm && rm.size > 0) return true;
  }
  return false;
};

/**
 * Helper to get all blocked user IDs associated with currentUserId
 */
const getBlockedUserIds = async (currentUserId) => {
  const blocks = await Block.find({
    $or: [{ blockerId: currentUserId }, { blockedId: currentUserId }]
  });
  const blockedIds = new Set();
  blocks.forEach(b => {
    if (b.blockerId.toString() === currentUserId.toString()) {
      blockedIds.add(b.blockedId.toString());
    } else {
      blockedIds.add(b.blockerId.toString());
    }
  });
  return Array.from(blockedIds);
};

/**
 * Like a user profile and check for mutual match
 */
exports.likeUser = async (req, res) => {
  try {
    const likedId = req.body.likedId || req.body.targetUserId || req.body.userId;
    const currentUserId = req.user._id;

    if (!likedId) {
      return res.status(400).json({ message: 'Liked user ID is required.' });
    }

    if (likedId.toString() === currentUserId.toString()) {
      return res.status(400).json({ message: 'You cannot like yourself.' });
    }

    // Check if either user has blocked the other
    const isBlocked = await Block.findOne({
      $or: [
        { blockerId: currentUserId, blockedId: likedId },
        { blockerId: likedId, blockedId: currentUserId }
      ]
    });

    if (isBlocked) {
      return res.status(400).json({ message: 'Cannot like this profile.' });
    }

    const existingLike = await Match.findOne({
      likerId: currentUserId,
      likedId: likedId
    });

    if (!existingLike) {
      const newLike = new Match({
        likerId: currentUserId,
        likedId: likedId
      });
      await newLike.save();
    }

    const reverseLike = await Match.findOne({
      likerId: likedId,
      likedId: currentUserId
    });

    const isMatch = !!reverseLike;

    // --- Trigger Push Notifications ---
    const currentUser = await User.findById(currentUserId).select('firstName name');
    const targetUser = await User.findById(likedId).select('firstName name');
    const senderName = currentUser?.firstName || currentUser?.name || 'Someone';
    const targetName = targetUser?.firstName || targetUser?.name || 'Someone';

    if (isMatch) {
      // Send Mutual Match Notification to both users with names in title
      sendPushNotification(likedId, {
        title: `🎉 It's a Match with ${senderName}!`,
        body: `You and ${senderName} liked each other! Start chatting now.`,
        data: { type: 'match', userId: currentUserId.toString() }
      }).catch(err => console.error('Match push error:', err));

      sendPushNotification(currentUserId, {
        title: `🎉 It's a Match with ${targetName}!`,
        body: `You and ${targetName} liked each other! Start chatting now.`,
        data: { type: 'match', userId: likedId.toString() }
      }).catch(err => console.error('Match push error:', err));

      // Emit real-time socket event if target user is online
      if (global.io && global.onlineUsers) {
        const likedSocketId = global.onlineUsers.get(likedId.toString());
        if (likedSocketId) {
          global.io.to(likedSocketId).emit('new_match', {
            matchedUser: {
              id: currentUser._id.toString(),
              name: currentUser.firstName || currentUser.name,
              profileImage: currentUser.profileImage || '',
            },
            title: `🎉 It's a Match with ${senderName}!`,
            body: `You and ${senderName} liked each other! Start chatting now.`
          });
        }
      }
    } else {
      // Send New Like Notification to likedId with sender's name
      sendPushNotification(likedId, {
        title: `❤️ ${senderName} liked your profile!`,
        body: `${senderName} liked your profile. Open the app to check out their profile!`,
        data: { type: 'like', userId: currentUserId.toString() }
      }).catch(err => console.error('Like push error:', err));

      // Emit real-time socket event if target user is online
      if (global.io && global.onlineUsers) {
        const likedSocketId = global.onlineUsers.get(likedId.toString());
        if (likedSocketId) {
          global.io.to(likedSocketId).emit('new_like', {
            likerUser: {
              id: currentUser._id.toString(),
              name: currentUser.firstName || currentUser.name,
              profileImage: currentUser.profileImage || '',
            },
            title: `❤️ ${senderName} liked your profile!`,
            body: `${senderName} liked your profile. Open the app to check out their profile!`
          });
        }
      }
    }

    return res.status(200).json({
      message: isMatch ? 'Mutual match registered!' : 'Like registered successfully.',
      isMatch
    });
  } catch (error) {
    console.error('Like user error:', error);
    return res.status(500).json({ message: 'Server error while liking user.' });
  }
};

/**
 * Dedicated API: Super Like a user profile (1 per 24 hours)
 */
exports.superLikeUser = async (req, res) => {
  try {
    const likedId = req.body.likedId || req.body.targetUserId || req.body.userId;
    const currentUserId = req.user._id;

    if (!likedId) {
      return res.status(400).json({ message: 'Liked user ID is required.' });
    }

    if (likedId.toString() === currentUserId.toString()) {
      return res.status(400).json({ message: 'You cannot Super Like yourself.' });
    }

    // Check if either user has blocked the other
    const isBlocked = await Block.findOne({
      $or: [
        { blockerId: currentUserId, blockedId: likedId },
        { blockerId: likedId, blockedId: currentUserId }
      ]
    });

    if (isBlocked) {
      return res.status(400).json({ message: 'Cannot Super Like this profile.' });
    }

    // Daily 24-hour limit check (1 per 24 hours)
    const currentUserDoc = await User.findById(currentUserId).select('lastSuperLikeDate');
    const now = new Date();
    if (currentUserDoc?.lastSuperLikeDate) {
      const lastDate = new Date(currentUserDoc.lastSuperLikeDate);
      const diffMs = now.getTime() - lastDate.getTime();
      const twentyFourHoursMs = 24 * 60 * 60 * 1000;
      if (diffMs < twentyFourHoursMs) {
        const hoursLeft = Math.ceil((twentyFourHoursMs - diffMs) / (60 * 60 * 1000));
        return res.status(400).json({
          message: `You have used your 1 free Super Like for today. Try again in ${hoursLeft} hour${hoursLeft > 1 ? 's' : ''}.`,
          canSuperLike: false,
          hoursUntilReset: hoursLeft
        });
      }
    }

    // Update lastSuperLikeDate to current timestamp
    await User.findByIdAndUpdate(currentUserId, { lastSuperLikeDate: now });

    const existingLike = await Match.findOne({
      likerId: currentUserId,
      likedId: likedId
    });

    if (!existingLike) {
      const newLike = new Match({
        likerId: currentUserId,
        likedId: likedId,
        isSuperLike: true,
      });
      await newLike.save();
    } else if (!existingLike.isSuperLike) {
      existingLike.isSuperLike = true;
      await existingLike.save();
    }

    const reverseLike = await Match.findOne({
      likerId: likedId,
      likedId: currentUserId
    });

    const isMatch = !!reverseLike;

    const currentUser = await User.findById(currentUserId).select('firstName name');
    const targetUser = await User.findById(likedId).select('firstName name');
    const senderName = currentUser?.firstName || currentUser?.name || 'Someone';
    const targetName = targetUser?.firstName || targetUser?.name || 'Someone';

    if (isMatch) {
      sendPushNotification(likedId, {
        title: `🎉 It's a Match with ${senderName}!`,
        body: `You and ${senderName} liked each other! Start chatting now.`,
        data: { type: 'match', userId: currentUserId.toString() }
      }).catch(err => console.error('Match push error:', err));

      sendPushNotification(currentUserId, {
        title: `🎉 It's a Match with ${targetName}!`,
        body: `You and ${targetName} liked each other! Start chatting now.`,
        data: { type: 'match', userId: likedId.toString() }
      }).catch(err => console.error('Match push error:', err));
    } else {
      sendPushNotification(likedId, {
        title: `⭐ ${senderName} Super Liked your profile!`,
        body: `${senderName} Super Liked your profile! Open the app to see them at the top of your Likes.`,
        data: { type: 'superlike', userId: currentUserId.toString() }
      }).catch(err => console.error('Super Like push error:', err));

      if (global.io && global.onlineUsers) {
        const likedSocketId = global.onlineUsers.get(likedId.toString());
        if (likedSocketId) {
          global.io.to(likedSocketId).emit('new_like', {
            likerUser: {
              id: currentUser._id.toString(),
              name: currentUser.firstName || currentUser.name,
              profileImage: currentUser.profileImage || '',
              isSuperLike: true,
            },
            title: `⭐ ${senderName} Super Liked your profile!`,
            body: `${senderName} Super Liked your profile! Open the app to see them at the top of your Likes.`
          });
        }
      }
    }

    return res.status(200).json({
      message: isMatch ? 'Mutual match registered!' : 'Super Like registered successfully!',
      isMatch,
      isSuperLike: true,
    });
  } catch (error) {
    console.error('Super Like user error:', error);
    return res.status(500).json({ message: 'Server error while Super Liking user.' });
  }
};

function getUserCoordinates(user) {
  if (!user) return null;
  const sources = [
    user.currentLocation?.location?.coordinates,
    user.location?.coordinates,
    user.permanentAddress?.location?.coordinates,
  ];

  for (const coords of sources) {
    if (Array.isArray(coords) && coords.length === 2) {
      const lng = parseFloat(coords[0]);
      const lat = parseFloat(coords[1]);
      if (!isNaN(lng) && !isNaN(lat) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }
  }
  return null;
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of Earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistanceText(currentUserCoords, targetUserCoords, fallbackDistanceRange) {
  if (currentUserCoords && targetUserCoords) {
    const kmVal = calculateHaversineDistance(
      currentUserCoords.lat,
      currentUserCoords.lng,
      targetUserCoords.lat,
      targetUserCoords.lng
    );
    const formatted = (Math.round(kmVal * 10) / 10).toString();
    return `${formatted} km away`;
  }
  if (fallbackDistanceRange) {
    return `${fallbackDistanceRange} km away`;
  }
  return 'Location unavailable';
}

/**
 * Get all users who liked the current user but have not been liked back yet
 */
exports.getLikes = async (req, res) => {
  try {
    const currentUserId = req.user._id;

    const blockedIds = await getBlockedUserIds(currentUserId);
    const currentUser = await User.findById(currentUserId);
    const currentUserCoords = getUserCoordinates(currentUser);

    const peopleWhoLikedMe = await Match.find({
      likedId: currentUserId,
      likerId: { $nin: blockedIds }
    });

    const superLikerMap = {};
    peopleWhoLikedMe.forEach((m) => {
      if (m.isSuperLike) {
        superLikerMap[m.likerId.toString()] = true;
      }
    });

    const likerIds = peopleWhoLikedMe.map(l => l.likerId);

    const peopleILiked = await Match.find({ likerId: currentUserId });
    const likedIds = peopleILiked.map(l => l.likedId.toString());

    const finalLikerIds = likerIds.filter(id => !likedIds.includes(id.toString()));

    const users = await User.find({
      _id: { $in: finalLikerIds, $nin: blockedIds }
    });

    const mappedUsers = users.map(u => {
      const targetUserCoords = getUserCoordinates(u);
      const isSuper = !!superLikerMap[u._id.toString()];
      return {
        id: u._id.toString(),
        name: u.firstName || u.name,
        email: u.email,
        age: u.age || null,
        distance: formatDistanceText(currentUserCoords, targetUserCoords, u.distanceRange),
        bio: u.bio || '',
        interests: u.interests || [],
        image: u.profileImage || '',
        gender: u.gender,
        orientation: u.orientation || '',
        lookingFor: u.lookingFor || '',
        drinkHabit: u.drinkHabit || '',
        smokeHabit: u.smokeHabit || '',
        exercise: u.exercise || '',
        pets: u.pets || '',
        educationLevel: u.educationLevel || '',
        zodiac: u.zodiac || '',
        height: u.height || '',
        weight: u.weight || '',
        job: u.job || '',
        college: u.college || '',
        isSuperLike: isSuper,
        isOnline: checkIsOnline(u),
        isVerified: !!u.isEmailVerified,
        isEmailVerified: !!u.isEmailVerified,
        isMobileVerified: !!u.isMobileVerified,
        lastSeen: u.lastSeen || u.updatedAt || u.createdAt,
      };
    });

    // Sort Super Liked users to the top of the list!
    mappedUsers.sort((a, b) => (b.isSuperLike ? 1 : 0) - (a.isSuperLike ? 1 : 0));

    return res.status(200).json({
      users: mappedUsers
    });
  } catch (error) {
    console.error('Get likes error:', error);
    return res.status(500).json({ message: 'Server error while fetching likes.' });
  }
};

/**
 * Get current user's Super Like availability status & reset timer
 */
exports.getSuperLikeStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('lastSuperLikeDate');
    const now = new Date();

    let canSuperLike = true;
    let secondsUntilReset = 0;

    if (user?.lastSuperLikeDate) {
      const lastDate = new Date(user.lastSuperLikeDate);
      const diffMs = now.getTime() - lastDate.getTime();
      const twentyFourHoursMs = 24 * 60 * 60 * 1000;

      if (diffMs < twentyFourHoursMs) {
        canSuperLike = false;
        secondsUntilReset = Math.ceil((twentyFourHoursMs - diffMs) / 1000);
      }
    }

    const hoursUntilReset = Math.ceil(secondsUntilReset / 3600);

    return res.status(200).json({
      canSuperLike,
      remainingSuperLikes: canSuperLike ? 1 : 0,
      lastSuperLikeDate: user?.lastSuperLikeDate || null,
      secondsUntilReset,
      hoursUntilReset,
    });
  } catch (error) {
    console.error('getSuperLikeStatus Error:', error);
    return res.status(500).json({ message: 'Server error checking superlike status.' });
  }
};

/**
 * Get all users who have mutually matched with the current user
 */
exports.getMatches = async (req, res) => {
  try {
    const currentUserId = req.user._id;


    const blockedIds = await getBlockedUserIds(currentUserId);
    const currentUser = await User.findById(currentUserId);
    const currentUserCoords = getUserCoordinates(currentUser);

    const peopleILiked = await Match.find({ likerId: currentUserId });
    const likedIds = peopleILiked.map(l => l.likedId.toString());

    const peopleWhoLikedMe = await Match.find({ likedId: currentUserId });
    const likerIds = peopleWhoLikedMe.map(l => l.likerId.toString());

    const mutualMatchIds = likedIds.filter(id => likerIds.includes(id) && !blockedIds.includes(id));

    const users = await User.find({
      _id: { $in: mutualMatchIds }
    });

    return res.status(200).json({
      matches: users.map(u => {
        const targetUserCoords = getUserCoordinates(u);
        return {
          id: u._id.toString(),
          name: u.firstName || u.name,
          email: u.email,
          age: u.age || null,
          distance: formatDistanceText(currentUserCoords, targetUserCoords, u.distanceRange),
          bio: u.bio || '',
          interests: u.interests || [],
          image: u.profileImage || '',
          gender: u.gender,
          orientation: u.orientation || '',
          lookingFor: u.lookingFor || '',
          drinkHabit: u.drinkHabit || '',
          smokeHabit: u.smokeHabit || '',
          exercise: u.exercise || '',
          pets: u.pets || '',
          educationLevel: u.educationLevel || '',
          zodiac: u.zodiac || '',
          height: u.height || '',
          weight: u.weight || '',
          job: u.job || '',
          college: u.college || '',
          isOnline: checkIsOnline(u),
          isVerified: !!u.isEmailVerified,
          isEmailVerified: !!u.isEmailVerified,
          isMobileVerified: !!u.isMobileVerified,
          lastSeen: u.lastSeen || u.updatedAt || u.createdAt,
        };
      })
    });
  } catch (error) {
    console.error('Fetch matches error:', error);
    return res.status(500).json({ message: 'Server error while fetching matches.' });
  }
};

/**
 * Reject a user's like (delete the like record from them to me)
 */
exports.rejectLike = async (req, res) => {
  try {
    const { likerId } = req.body;
    const currentUserId = req.user._id;

    if (!likerId) {
      return res.status(400).json({ message: 'Liker user ID is required.' });
    }

    await Match.deleteOne({
      likerId: likerId,
      likedId: currentUserId
    });

    return res.status(200).json({
      message: 'Like rejected/dismissed successfully.'
    });
  } catch (error) {
    console.error('Reject like error:', error);
    return res.status(500).json({ message: 'Server error while rejecting like.' });
  }
};

/**
 * Get all user IDs that the current user has already liked/swiped
 */
exports.getSwipedIds = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const swiped = await Match.find({ likerId: currentUserId });
    const swipedIds = swiped.map(s => s.likedId.toString());

    return res.status(200).json(swipedIds);
  } catch (error) {
    console.error('Fetch swiped IDs error:', error);
    return res.status(500).json({ message: 'Server error while fetching swiped IDs.' });
  }
};

/**
 * Unmatch a mutually matched user (deletes matches and clears messages between the two users)
 */
exports.unmatchUser = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = req.user._id;

    if (!targetUserId) {
      return res.status(400).json({ message: 'Target user ID is required.' });
    }

    console.log('=== /unmatch API Triggered ===');
    console.log('Unmatcher:', currentUserId.toString(), 'Target:', targetUserId);

    await Match.deleteMany({
      $or: [
        { likerId: currentUserId, likedId: targetUserId },
        { likerId: targetUserId, likedId: currentUserId }
      ]
    });

    await Message.deleteMany({
      $or: [
        { senderId: currentUserId, receiverId: targetUserId },
        { senderId: targetUserId, receiverId: currentUserId }
      ]
    });

    const io = req.app.get('io');
    if (io) {
      const receiverSocketId = global.onlineUsers ? global.onlineUsers.get(targetUserId.toString()) : null;
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('unmatched', { unmatchedBy: currentUserId.toString() });
      }
    }

    return res.status(200).json({
      message: 'Successfully unmatched.'
    });
  } catch (error) {
    console.error('Unmatch error:', error);
    return res.status(500).json({ message: 'Server error while unmatching.' });
  }
};

/**
 * Block a user (creates Block entry, deletes matches and messages)
 */
exports.blockUser = async (req, res) => {
  try {
    const rawTarget = req.body?.targetUserId || req.body?.targetId || req.body?.reportedId || req.body?.userId;
    const currentUserId = req.user?._id;

    if (!rawTarget) {
      return res.status(400).json({ success: false, message: 'Target user ID is required.' });
    }

    const targetUserIdStr = typeof rawTarget === 'object'
      ? (rawTarget.id || rawTarget._id || rawTarget.userId)?.toString()
      : rawTarget.toString();

    if (!targetUserIdStr) {
      return res.status(400).json({ success: false, message: 'Invalid target user ID.' });
    }

    if (currentUserId && targetUserIdStr === currentUserId.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot block yourself.' });
    }

    console.log('=== /block API Triggered ===');
    console.log('Blocker:', currentUserId?.toString(), 'Blocked:', targetUserIdStr);

    const isValidObjectId = mongoose.Types.ObjectId.isValid(targetUserIdStr);

    if (currentUserId && isValidObjectId) {
      const targetObjectId = new mongoose.Types.ObjectId(targetUserIdStr);

      await Block.findOneAndUpdate(
        { blockerId: currentUserId, blockedId: targetObjectId },
        { $set: { blockerId: currentUserId, blockedId: targetObjectId, reason: req.body?.reason || '' } },
        { upsert: true, new: true }
      );

      await Match.deleteMany({
        $or: [
          { likerId: currentUserId, likedId: targetObjectId },
          { likerId: targetObjectId, likedId: currentUserId }
        ]
      });

      await Message.deleteMany({
        $or: [
          { senderId: currentUserId, receiverId: targetObjectId },
          { senderId: targetObjectId, receiverId: currentUserId }
        ]
      });
    }

    const io = req.app.get('io');
    if (io) {
      const receiverSocketId = global.onlineUsers ? global.onlineUsers.get(targetUserIdStr) : null;
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('user_blocked', { blockedBy: currentUserId?.toString() });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'User blocked successfully.'
    });
  } catch (error) {
    console.error('Block user error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error while blocking user.' });
  }
};

/**
 * Report a user profile (saves Report record for Admin panel handling)
 */
exports.reportUser = async (req, res) => {
  try {
    const { reportedId, targetUserId, reportedUserId, reason, details } = req.body;
    const currentUserId = req.user._id;
    const targetId = reportedId || targetUserId || reportedUserId;

    if (!targetId) {
      return res.status(400).json({ message: 'Reported user ID is required.' });
    }

    if (!reason) {
      return res.status(400).json({ message: 'Report reason is required.' });
    }

    console.log('=== /report API Triggered ===');
    console.log('Reporter:', currentUserId.toString(), 'Reported Target:', targetId, 'Reason:', reason);

    const newReport = new Report({
      reporterId: currentUserId,
      reportedId: targetId,
      reason,
      details: details || '',
      status: 'pending'
    });

    await newReport.save();

    return res.status(201).json({
      message: 'Report submitted successfully. Our admin team will review it.'
    });
  } catch (error) {
    console.error('Report user error:', error);
    return res.status(500).json({ message: 'Server error while submitting report.' });
  }
};

/**
 * Undo / Rewind last swipe (delete Match record between current user and target user)
 */
exports.undoSwipe = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = req.user._id;

    if (!targetUserId) {
      return res.status(400).json({ message: 'Target user ID is required.' });
    }

    await Match.deleteMany({
      likerId: currentUserId,
      likedId: targetUserId
    });

    return res.status(200).json({
      success: true,
      message: 'Last swipe undone successfully.'
    });
  } catch (error) {
    console.error('Undo swipe error:', error);
    return res.status(500).json({ message: 'Server error while undoing swipe.' });
  }
};

/**
 * GET /api/match/blocked-users
 * GET /api/match/blocked-users/:userId
 * Fetch the list of users blocked by a specific user (or current logged-in user)
 */
exports.getBlockedUsers = async (req, res) => {
  try {
    const paramUserId = req.params?.userId || req.query?.userId;
    let targetUserId = req.user?._id;

    if (paramUserId && paramUserId !== 'me' && paramUserId !== 'self') {
      if (mongoose.Types.ObjectId.isValid(paramUserId)) {
        targetUserId = new mongoose.Types.ObjectId(paramUserId);
      } else {
        return res.status(400).json({ success: false, message: 'Invalid user ID parameter.' });
      }
    }

    if (!targetUserId) {
      return res.status(401).json({ success: false, message: 'Unauthorized.' });
    }

    console.log(`[getBlockedUsers] Fetching blocked users for blockerId: ${targetUserId.toString()}`);

    const blocks = await Block.find({ blockerId: targetUserId })
      .populate('blockedId', 'name firstName email mobile gender age profileImage photos media bio city country createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const blockedUsers = blocks
      .filter((b) => b.blockedId)
      .map((b) => {
        const u = b.blockedId;
        return {
          id: u._id.toString(),
          _id: u._id.toString(),
          userId: u._id.toString(),
          name: u.name || u.firstName || 'User',
          firstName: u.firstName || u.name || 'User',
          email: u.email || '',
          mobile: u.mobile || '',
          gender: u.gender || '',
          age: u.age || null,
          city: u.city || '',
          country: u.country || '',
          bio: u.bio || '',
          profileImage: u.profileImage || (Array.isArray(u.photos) && u.photos[0]) || (Array.isArray(u.media) && u.media[0]) || null,
          photos: u.photos || [],
          blockedAt: b.createdAt,
          blockReason: b.reason || '',
          blockId: b._id.toString(),
        };
      });

    return res.status(200).json({
      success: true,
      count: blockedUsers.length,
      blockedUsers,
      data: blockedUsers,
    });
  } catch (error) {
    console.error('Error fetching blocked users:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching blocked users.' });
  }
};

/**
 * POST /api/match/unblock
 * POST /api/match/unblock/:userId
 * Unblock a previously blocked user
 */
exports.unblockUser = async (req, res) => {
  try {
    const rawTarget = req.body?.targetUserId || req.body?.blockedId || req.body?.targetId || req.params?.userId;
    const currentUserId = req.user?._id;

    if (!rawTarget) {
      return res.status(400).json({ success: false, message: 'Target user ID to unblock is required.' });
    }

    const targetUserIdStr = typeof rawTarget === 'object'
      ? (rawTarget.id || rawTarget._id || rawTarget.userId)?.toString()
      : rawTarget.toString();

    if (!targetUserIdStr || !mongoose.Types.ObjectId.isValid(targetUserIdStr)) {
      return res.status(400).json({ success: false, message: 'Invalid target user ID.' });
    }

    const targetObjectId = new mongoose.Types.ObjectId(targetUserIdStr);

    const deleteRes = await Block.deleteMany({
      blockerId: currentUserId,
      blockedId: targetObjectId,
    });

    console.log(`[unblockUser] Blocker: ${currentUserId?.toString()} unblocked User: ${targetUserIdStr}. Deleted count: ${deleteRes.deletedCount}`);

    return res.status(200).json({
      success: true,
      message: 'User unblocked successfully.',
      unblockedUserId: targetUserIdStr,
    });
  } catch (error) {
    console.error('Error unblocking user:', error);
    return res.status(500).json({ success: false, message: 'Server error while unblocking user.' });
  }
};
