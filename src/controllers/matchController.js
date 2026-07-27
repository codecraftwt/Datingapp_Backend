const Match = require('../models/Match');
const User = require('../models/User');
const Message = require('../models/Message');
const Block = require('../models/Block');
const Report = require('../models/Report');

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
    const { likedId } = req.body;
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
 * Get all users who liked the current user but have not been liked back yet
 */
exports.getLikes = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const blockedIds = await getBlockedUserIds(currentUserId);

    const peopleWhoLikedMe = await Match.find({
      likedId: currentUserId,
      likerId: { $nin: blockedIds }
    });
    const likerIds = peopleWhoLikedMe.map(l => l.likerId);

    const peopleILiked = await Match.find({ likerId: currentUserId });
    const likedIds = peopleILiked.map(l => l.likedId.toString());

    const finalLikerIds = likerIds.filter(id => !likedIds.includes(id.toString()));

    const users = await User.find({
      _id: { $in: finalLikerIds, $nin: blockedIds }
    });

    return res.status(200).json({
      users: users.map(u => ({
        id: u._id.toString(),
        name: u.firstName || u.name,
        email: u.email,
        age: u.age || 22,
        distance: u.distanceRange ? `${u.distanceRange} miles away` : '3 miles away',
        bio: u.bio || '',
        interests: u.interests && u.interests.length > 0 ? u.interests : ['☕ Coffee lover'],
        image: u.profileImage || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=600',
        gender: u.gender,
        orientation: u.orientation || 'Straight',
        lookingFor: u.lookingFor || 'Long-term partner',
        drinkHabit: u.drinkHabit || 'Social drinker',
        smokeHabit: u.smokeHabit || 'Never',
        exercise: u.exercise || 'Occasionally',
        pets: u.pets || 'Dog',
        educationLevel: u.educationLevel || 'Undergraduate Degree',
        zodiac: u.zodiac || 'Gemini',
      }))
    });
  } catch (error) {
    console.error('Fetch likes error:', error);
    return res.status(500).json({ message: 'Server error while fetching likes.' });
  }
};

/**
 * Get all users who have mutually matched with the current user
 */
exports.getMatches = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const blockedIds = await getBlockedUserIds(currentUserId);

    const peopleILiked = await Match.find({ likerId: currentUserId });
    const likedIds = peopleILiked.map(l => l.likedId.toString());

    const peopleWhoLikedMe = await Match.find({ likedId: currentUserId });
    const likerIds = peopleWhoLikedMe.map(l => l.likerId.toString());

    const mutualMatchIds = likedIds.filter(id => likerIds.includes(id) && !blockedIds.includes(id));

    const users = await User.find({
      _id: { $in: mutualMatchIds }
    });

    return res.status(200).json({
      matches: users.map(u => ({
        id: u._id.toString(),
        name: u.firstName || u.name,
        email: u.email,
        age: u.age || 22,
        distance: u.distanceRange ? `${u.distanceRange} miles away` : '3 miles away',
        bio: u.bio || '',
        interests: u.interests && u.interests.length > 0 ? u.interests : ['☕ Coffee lover'],
        image: u.profileImage || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=600',
        gender: u.gender,
        orientation: u.orientation || 'Straight',
        lookingFor: u.lookingFor || 'Long-term partner',
        drinkHabit: u.drinkHabit || 'Social drinker',
        smokeHabit: u.smokeHabit || 'Never',
        exercise: u.exercise || 'Occasionally',
        pets: u.pets || 'Dog',
        educationLevel: u.educationLevel || 'Undergraduate Degree',
        zodiac: u.zodiac || 'Gemini',
        isOnline: (u.isLoggedIn === true) && (global.onlineUsers ? global.onlineUsers.has(u._id.toString()) : false),
        lastSeen: u.lastSeen || u.updatedAt || u.createdAt,
      }))
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
    const { targetUserId, reason } = req.body;
    const currentUserId = req.user._id;

    if (!targetUserId) {
      return res.status(400).json({ message: 'Target user ID is required.' });
    }

    if (targetUserId.toString() === currentUserId.toString()) {
      return res.status(400).json({ message: 'You cannot block yourself.' });
    }

    console.log('=== /block API Triggered ===');
    console.log('Blocker:', currentUserId.toString(), 'Blocked:', targetUserId);

    // 1. Create or update Block record
    await Block.findOneAndUpdate(
      { blockerId: currentUserId, blockedId: targetUserId },
      { $set: { blockerId: currentUserId, blockedId: targetUserId, reason: reason || '' } },
      { upsert: true, new: true }
    );

    // 2. Remove matches between the two users
    await Match.deleteMany({
      $or: [
        { likerId: currentUserId, likedId: targetUserId },
        { likerId: targetUserId, likedId: currentUserId }
      ]
    });

    // 3. Clear messages between the two users
    await Message.deleteMany({
      $or: [
        { senderId: currentUserId, receiverId: targetUserId },
        { senderId: targetUserId, receiverId: currentUserId }
      ]
    });

    // 4. Notify receiver via Socket if online
    const io = req.app.get('io');
    if (io) {
      const receiverSocketId = global.onlineUsers ? global.onlineUsers.get(targetUserId.toString()) : null;
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('user_blocked', { blockedBy: currentUserId.toString() });
      }
    }

    return res.status(200).json({
      message: 'User blocked successfully.'
    });
  } catch (error) {
    console.error('Block user error:', error);
    return res.status(500).json({ message: 'Server error while blocking user.' });
  }
};

/**
 * Report a user profile (saves Report record for Admin panel handling)
 */
exports.reportUser = async (req, res) => {
  try {
    const { reportedId, targetUserId, reason, details } = req.body;
    const currentUserId = req.user._id;
    const targetId = reportedId || targetUserId;

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
