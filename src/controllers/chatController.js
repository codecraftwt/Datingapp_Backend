const Message = require('../models/Message');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Block = require('../models/Block');
const { sendPushNotification } = require('../services/pushNotificationService');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dwwykeft2',
  api_key: process.env.CLOUDINARY_API_KEY || '888317163598995',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'VYck0A_t17ivmkR6DQApA_FU_Nk',
});

/**
 * Get all chat messages involving the authenticated user
 */
exports.getMessages = async (req, res) => {
  try {
    const currentUserId = req.user._id;

    const messages = await Message.find({
      $or: [
        { senderId: currentUserId, deletedBySender: { $ne: true } },
        { receiverId: currentUserId, deletedByReceiver: { $ne: true } }
      ]
    }).sort({ createdAt: 1 });

    return res.status(200).json(messages);
  } catch (error) {
    console.error('Fetch all messages error:', error);
    return res.status(500).json({ message: 'Server error while fetching messages.' });
  }
};

/**
 * Get all chat messages between the authenticated user and the selected user
 */
exports.getChatMessages = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { selectedUserId } = req.params;

    // Automatically mark all unread chat notifications & messages from this sender as read/seen
    Notification.updateMany(
      { recipient: currentUserId, sender: selectedUserId, type: 'chat', isRead: false },
      { isRead: true }
    ).catch(() => {});

    Message.updateMany(
      { senderId: selectedUserId, receiverId: currentUserId, status: { $ne: 'seen' } },
      { status: 'seen' }
    ).then((resUpdate) => {
      if (resUpdate && resUpdate.modifiedCount > 0) {
        const io = req.app.get('io');
        if (io) {
          const payload = {
            senderId: selectedUserId.toString(),
            receiverId: currentUserId.toString(),
            status: 'seen',
          };
          io.to(selectedUserId.toString()).emit('messages_seen', payload);
          const onlineUsers = global.onlineUsers || new Map();
          const senderSocketId = onlineUsers.get(selectedUserId.toString());
          if (senderSocketId) io.to(senderSocketId).emit('messages_seen', payload);
        }
      }
    }).catch(() => {});

    const messages = await Message.find({
      $or: [
        { senderId: currentUserId, receiverId: selectedUserId, deletedBySender: { $ne: true } },
        { senderId: selectedUserId, receiverId: currentUserId, deletedByReceiver: { $ne: true } }
      ]
    }).sort({ createdAt: 1 });

    const selObjectId = mongoose.Types.ObjectId.isValid(selectedUserId) ? new mongoose.Types.ObjectId(selectedUserId) : selectedUserId;

    const blockByMe = await Block.findOne({
      $or: [
        { blockerId: currentUserId, blockedId: selObjectId },
        { blockerId: currentUserId.toString(), blockedId: selectedUserId.toString() },
      ],
    });

    const blockByOther = await Block.findOne({
      $or: [
        { blockerId: selObjectId, blockedId: currentUserId },
        { blockerId: selectedUserId.toString(), blockedId: currentUserId.toString() },
      ],
    });

    const isBlockedByMe = !!blockByMe;
    const isBlockedByOther = !!blockByOther;

    return res.status(200).json({
      success: true,
      messages,
      isBlockedByMe,
      isBlockedByOther,
    });
  } catch (error) {
    console.error('Fetch messages with user error:', error);
    return res.status(500).json({ message: 'Server error while fetching messages.' });
  }
};

/**
 * Edit a text message sent by the authenticated user
 */
exports.editMessage = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { messageId } = req.params;
    const { text } = req.body;

    if (!text || text.trim() === '') {
      return res.status(400).json({ message: 'Message text cannot be empty.' });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found.' });
    }

    if (message.senderId.toString() !== currentUserId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to edit this message.' });
    }

    message.text = text;
    message.isEdited = true;
    await message.save();

    const io = req.app.get('io');
    if (io && global.onlineUsers) {
      const receiverId = message.receiverId.toString();
      const receiverSocketId = global.onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('message_edited', {
          messageId: messageId.toString(),
          text: message.text,
          isEdited: true,
          senderId: currentUserId.toString(),
          receiverId
        });
      }
    }

    return res.status(200).json({ message: 'Message updated successfully.', message });
  } catch (error) {
    console.error('Edit message error:', error);
    return res.status(500).json({ message: 'Server error while editing message.' });
  }
};

/**
 * Delete a message sent by the authenticated user
 */
exports.deleteMessage = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found.' });
    }

    if (message.senderId.toString() !== currentUserId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to delete this message.' });
    }

    const receiverId = message.receiverId.toString();
    await Message.findByIdAndDelete(messageId);

    const io = req.app.get('io');
    if (io && global.onlineUsers) {
      const receiverSocketId = global.onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('message_deleted', {
          messageId: messageId.toString(),
          senderId: currentUserId.toString(),
          receiverId
        });
      }
    }

    return res.status(200).json({ message: 'Message deleted successfully.', messageId });
  } catch (error) {
    console.error('Delete message error:', error);
    return res.status(500).json({ message: 'Server error while deleting message.' });
  }
};

/**
 * Clear all chat messages (conversations) globally for the authenticated user
 */
exports.clearAllChats = async (req, res) => {
  try {
    const currentUserId = req.user._id;

    await Message.updateMany(
      { senderId: currentUserId },
      { $set: { deletedBySender: true } }
    );

    await Message.updateMany(
      { receiverId: currentUserId },
      { $set: { deletedByReceiver: true } }
    );

    await Message.deleteMany({
      deletedBySender: true,
      deletedByReceiver: true
    });

    return res.status(200).json({ message: 'All conversations cleared successfully.' });
  } catch (error) {
    console.error('Clear all conversations error:', error);
    return res.status(500).json({ message: 'Server error while clearing conversations.' });
  }
};

/**
 * Clear all chat messages between the authenticated user and a specific user
 */
exports.clearChat = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { selectedUserId } = req.params;

    await Message.updateMany(
      { senderId: currentUserId, receiverId: selectedUserId },
      { $set: { deletedBySender: true } }
    );

    await Message.updateMany(
      { senderId: selectedUserId, receiverId: currentUserId },
      { $set: { deletedByReceiver: true } }
    );

    await Message.deleteMany({
      senderId: { $in: [currentUserId, selectedUserId] },
      receiverId: { $in: [currentUserId, selectedUserId] },
      deletedBySender: true,
      deletedByReceiver: true
    });

    return res.status(200).json({ message: 'Chat history cleared successfully.' });
  } catch (error) {
    console.error('Clear chat error:', error);
    return res.status(500).json({ message: 'Server error while clearing chat.' });
  }
};

/**
 * Upload chat media to Cloudinary (for photos & documents)
 */
exports.uploadChatMedia = async (req, res) => {
  try {
    const file = req.file || (req.files && req.files.length > 0 ? req.files[0] : null);
    const bodyFile = req.body?.file || req.body?.image || req.body?.photo || req.body?.base64;

    if (!file && !bodyFile) {
      return res.status(400).json({ message: 'No file uploaded.' });
    }

    let mediaUrl = null;
    let originalName = file?.originalname || 'chat_file';
    let size = file?.size || 0;

    const doCloudinaryUpload = async (inputData) => {
      let resourceType = 'auto';
      if (file && file.mimetype) {
        if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
          resourceType = 'video';
        } else if (!file.mimetype.startsWith('image/')) {
          resourceType = 'raw';
        }
      } else if (file && file.originalname) {
        const lowerName = file.originalname.toLowerCase();
        if (/\.(mp3|m4a|aac|wav|ogg|3gp|mp4|mov|webm)$/.test(lowerName)) {
          resourceType = 'video';
        }
      }

      const typesToTry = [resourceType, 'auto', 'raw'].filter((v, idx, arr) => arr.indexOf(v) === idx);

      for (const resType of typesToTry) {
        try {
          console.log(`Chat Media: Uploading to Cloudinary with resource_type='${resType}'...`);
          const cloudRes = await cloudinary.uploader.upload(inputData, {
            folder: 'dating_app_chat_media',
            resource_type: resType,
          });
          if (cloudRes && cloudRes.secure_url) {
            return cloudRes.secure_url;
          }
        } catch (err1) {
          console.warn(`Chat Media signed upload (${resType}) failed:`, err1.message || err1);
          try {
            const cloudRes = await cloudinary.uploader.unsigned_upload(inputData, 'Dating_Profiles', {
              resource_type: resType,
            });
            if (cloudRes && cloudRes.secure_url) {
              return cloudRes.secure_url;
            }
          } catch (err2) {
            console.warn(`Chat Media unsigned_upload (${resType}) failed:`, err2.message || err2);
          }
        }
      }
      return null;
    };

    if (file && file.path) {
      mediaUrl = await doCloudinaryUpload(file.path);
      if (!mediaUrl) {
        const filename = path.basename(file.path);
        const protocol = req.protocol || 'http';
        let host = req.get('host') || 'localhost:5000';
        mediaUrl = `${protocol}://${host}/uploads/${filename}`;
        console.log('[uploadChatMedia] Using local /uploads/ fallback URL:', mediaUrl);
      } else {
        if (fs.existsSync(file.path)) {
          try { fs.unlinkSync(file.path); } catch (e) {}
        }
      }
    } else if (file && file.buffer) {
      const mime = file.mimetype || 'image/jpeg';
      const base64Str = `data:${mime};base64,${file.buffer.toString('base64')}`;
      mediaUrl = await doCloudinaryUpload(base64Str);
      if (!mediaUrl) {
        console.log('Chat Media: Using Base64 Data URI fallback');
        mediaUrl = base64Str;
      }
    } else if (bodyFile && typeof bodyFile === 'string' && bodyFile.length > 20) {
      mediaUrl = await doCloudinaryUpload(bodyFile);
      if (!mediaUrl) {
        mediaUrl = bodyFile;
      }
    }

    if (!mediaUrl) {
      return res.status(500).json({ message: 'Failed to upload chat media to Cloudinary.' });
    }

    return res.status(200).json({
      message: 'Chat media uploaded successfully to Cloudinary',
      url: mediaUrl,
      fileName: originalName,
      fileSize: size,
    });
  } catch (error) {
    console.error('Chat media upload error:', error);
    return res.status(500).json({ message: 'Server error during chat media upload.', error: error.message });
  }
};

/**
 * Send a chat message (REST API Fallback for Vercel/Serverless environments)
 */
exports.sendMessage = async (req, res) => {
  try {
    const senderId = req.user._id;
    const { receiverId, text, messageType, mediaUrl, fileName, fileSize, stickerId, tempId } = req.body;

    if (!receiverId) {
      return res.status(400).json({ message: 'Receiver ID is required.' });
    }
    if (!text && !mediaUrl && !stickerId) {
      return res.status(400).json({ message: 'Message content is required.' });
    }

    const rIdStr = receiverId.toString();
    const sIdStr = senderId.toString();

    // Check if receiver has blocked sender
    const isBlockedByReceiver = await Block.findOne({
      blockerId: receiverId,
      blockedId: senderId,
    });

    if (isBlockedByReceiver) {
      return res.status(403).json({ message: 'You cannot send messages to this user because you are blocked.' });
    }

    // Deduplicate: Check if this message was already sent/saved via socket or earlier REST call
    const dedupeQuery = [];
    if (tempId) dedupeQuery.push({ tempId: tempId });
    if (text) {
      dedupeQuery.push({
        senderId,
        receiverId,
        text: text.trim(),
        createdAt: { $gte: new Date(Date.now() - 10000) }
      });
    }

    if (dedupeQuery.length > 0) {
      const existingMessage = await Message.findOne({ $or: dedupeQuery });
      if (existingMessage) {
        console.log(`[REST sendMessage] Deduplicated duplicate message call for tempId: ${tempId || existingMessage._id}`);
        return res.status(200).json({
          message: 'Message sent (deduplicated)',
          data: existingMessage,
        });
      }
    }

    const onlineUsers = global.onlineUsers || new Map();
    const io = req.app.get('io');
    const isReceiverOnline = onlineUsers.has(rIdStr) || (io && io.sockets.adapter.rooms.has(rIdStr) && io.sockets.adapter.rooms.get(rIdStr).size > 0);
    const initialStatus = isReceiverOnline ? 'delivered' : 'sent';

    const newMessage = new Message({
      senderId,
      receiverId,
      text,
      messageType: messageType || 'text',
      mediaUrl,
      fileName,
      fileSize,
      stickerId,
      status: initialStatus,
    });
    await newMessage.save();

    const msgData = {
      _id: newMessage._id,
      senderId: sIdStr,
      receiverId: rIdStr,
      text: newMessage.text,
      messageType: newMessage.messageType,
      mediaUrl: newMessage.mediaUrl,
      fileName: newMessage.fileName,
      fileSize: newMessage.fileSize,
      stickerId: newMessage.stickerId,
      status: newMessage.status,
      createdAt: newMessage.createdAt,
      tempId: tempId || null,
    };

    if (io) {
      io.to(rIdStr).emit('receive_message', msgData);
      const receiverSocketId = onlineUsers.get(rIdStr);
      if (receiverSocketId) io.to(receiverSocketId).emit('receive_message', msgData);

      io.to(sIdStr).emit('message_sent', msgData);
      const senderSocketId = onlineUsers.get(sIdStr);
      if (senderSocketId) io.to(senderSocketId).emit('message_sent', msgData);

      if (isReceiverOnline) {
        const deliveryPayload = { messageId: newMessage._id.toString(), tempId: tempId || null, receiverId: rIdStr, status: 'delivered' };
        io.to(sIdStr).emit('message_delivered', deliveryPayload);
        if (senderSocketId) io.to(senderSocketId).emit('message_delivered', deliveryPayload);
      }
    }

    // Trigger FCM Push Notification
    const senderUser = await User.findById(senderId).select('firstName name');
    const senderName = senderUser?.firstName || senderUser?.name || 'Someone';

    let notificationText = '💬 Sent a message';
    let notificationTitle = `💬 ${senderName}`;

    if (messageType === 'voice') {
      notificationTitle = `🎤 Voice Message from ${senderName}`;
      notificationText = '🎤 Sent a voice note / audio message';
    } else if (messageType === 'call') {
      notificationTitle = `📞 Voice Call from ${senderName}`;
      notificationText = text || '📞 Voice call';
    } else if (messageType === 'image') {
      notificationText = '📷 Sent a photo';
    } else if (messageType === 'video') {
      notificationText = '🎬 Sent a video';
    } else if (messageType === 'document') {
      notificationText = '📄 Sent a document';
    } else if (messageType === 'sticker') {
      notificationText = '😊 Sent a sticker';
    } else if (text) {
      notificationText = text;
    }

    sendPushNotification(receiverId, {
      title: notificationTitle,
      body: notificationText,
      data: {
        type: 'chat',
        messageType: messageType || 'text',
        senderId: senderId.toString(),
        messageId: newMessage._id.toString(),
        notificationId: newMessage._id.toString(),
      },
    }).catch((err) => console.error('REST Chat FCM push error:', err));

    return res.status(201).json({ message: 'Message sent successfully.', data: msgData });
  } catch (error) {
    console.error('Send message REST API error:', error);
    return res.status(500).json({ message: 'Server error while sending message.' });
  }
};
