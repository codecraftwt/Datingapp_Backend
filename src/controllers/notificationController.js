const Notification = require('../models/Notification');
const Message = require('../models/Message');

/**
 * Get unread notifications for logged in user (called on login/app launch)
 */
exports.getUnreadNotifications = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Sync & cleanup: find any chat notifications whose messages have already been seen
    const unreadChatNotifs = await Notification.find({ recipient: userId, type: 'chat', isRead: false });
    for (const notif of unreadChatNotifs) {
      const msgId = notif.data?.messageId;
      if (msgId) {
        const msg = await Message.findById(msgId);
        if (!msg || msg.status === 'seen') {
          await Notification.findByIdAndUpdate(notif._id, { isRead: true });
          continue;
        }
      }

      if (notif.sender) {
        const unreadMsgCount = await Message.countDocuments({
          senderId: notif.sender,
          receiverId: userId,
          status: { $ne: 'seen' },
        });
        if (unreadMsgCount === 0) {
          await Notification.findByIdAndUpdate(notif._id, { isRead: true });
        }
      }
    }

    // 2. Query strictly unread notifications
    const notifications = await Notification.find({ recipient: userId, isRead: false })
      .populate('sender', 'firstName name profileImage avatar age')
      .sort({ createdAt: -1 })
      .limit(50);

    const unreadCount = notifications.length;

    return res.status(200).json({
      success: true,
      unreadCount,
      notifications,
    });
  } catch (error) {
    console.error('Get unread notifications error:', error);
    return res.status(500).json({ message: 'Server error fetching unread notifications.' });
  }
};

/**
 * Mark specified notifications or all notifications as read
 */
exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const { notificationIds, markAll } = req.body;

    if (markAll) {
      await Notification.updateMany({ recipient: userId, isRead: false }, { isRead: true });
      return res.status(200).json({ message: 'All notifications marked as read.' });
    }

    if (Array.isArray(notificationIds) && notificationIds.length > 0) {
      await Notification.updateMany(
        { _id: { $in: notificationIds }, recipient: userId },
        { isRead: true }
      );
    }

    return res.status(200).json({ message: 'Notifications marked as read.' });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    return res.status(500).json({ message: 'Server error marking notifications as read.' });
  }
};

/**
 * Mark all 'like' and 'superlike' notifications as read for logged in user
 */
exports.markLikesAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    await Notification.updateMany(
      { recipient: userId, type: { $in: ['like', 'superlike'] }, isRead: false },
      { isRead: true }
    );
    return res.status(200).json({ message: 'Like and superlike notifications marked as read.' });
  } catch (error) {
    console.error('Mark likes read error:', error);
    return res.status(500).json({ message: 'Server error marking likes as read.' });
  }
};

/**
 * Mark all 'match' notifications as read for logged in user
 */
exports.markMatchesAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    await Notification.updateMany({ recipient: userId, type: 'match', isRead: false }, { isRead: true });
    return res.status(200).json({ message: 'Match notifications marked as read.' });
  } catch (error) {
    console.error('Mark matches read error:', error);
    return res.status(500).json({ message: 'Server error marking matches as read.' });
  }
};

/**
 * Get all notification history for logged in user
 */
exports.getAllNotifications = async (req, res) => {
  try {
    const userId = req.user._id;

    const notifications = await Notification.find({ recipient: userId })
      .populate('sender', 'firstName name profileImage avatar age')
      .sort({ createdAt: -1 })
      .limit(100);

    return res.status(200).json({
      success: true,
      notifications,
    });
  } catch (error) {
    console.error('Get all notifications error:', error);
    return res.status(500).json({ message: 'Server error fetching notification history.' });
  }
};
