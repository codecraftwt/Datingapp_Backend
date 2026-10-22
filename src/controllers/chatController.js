const mongoose = require('mongoose');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Block = require('../models/Block');
const ChatMedia = require('../models/ChatMedia');
const { sendPushNotification } = require('../services/pushNotificationService');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dwwykeft2',
  api_key: process.env.CLOUDINARY_API_KEY || '888317163598995',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'VYck0A_t17ivmkR6DQApA_FU_Nk',
});

const checkIsOnline = (user) => {
  if (!user) return false;
  if (user.isLoggedIn === false || user.isOnline === false) return false;
  const uIdStr = (user._id || user.id || user).toString();

  const hasOnlineUserMap = global.onlineUsers ? global.onlineUsers.has(uIdStr) : false;
  const lastPing = global.userLastPing ? global.userLastPing.get(uIdStr) : null;
  const hasRecentHeartbeat = !!(lastPing && (Date.now() - lastPing < 35000));

  let inRoom = false;
  if (global.io && global.io.sockets && global.io.sockets.adapter && global.io.sockets.adapter.rooms.has(uIdStr)) {
    const rm = global.io.sockets.adapter.rooms.get(uIdStr);
    if (rm && rm.size > 0) inRoom = true;
  }

  const hasActiveSession = hasOnlineUserMap || inRoom || hasRecentHeartbeat;
  return hasActiveSession;
};

/**
 * Get all chat messages involving the authenticated user.
 * Also returns a `conversationPartners` map (userId -> { name, image, isOnline, lastSeen })
 */
exports.getMessages = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const currentUserIdStr = currentUserId.toString();

    const messages = await Message.find({
      $or: [
        { senderId: currentUserId, deletedBySender: { $ne: true } },
        { receiverId: currentUserId, deletedByReceiver: { $ne: true } }
      ]
    }).sort({ createdAt: 1 });

    // Collect all unique partner IDs from messages
    const partnerIdSet = new Set();
    messages.forEach((msg) => {
      const sId = msg.senderId?.toString();
      const rId = msg.receiverId?.toString();
      if (sId && sId !== currentUserIdStr) partnerIdSet.add(sId);
      if (rId && rId !== currentUserIdStr) partnerIdSet.add(rId);
    });

    // Fetch partner user records in one batch query
    const partnerUsers = await User.find(
      { _id: { $in: Array.from(partnerIdSet) } },
      'firstName name profileImage isLoggedIn isOnline lastSeen'
    ).lean();

    const conversationPartners = {};
    partnerUsers.forEach((u) => {
      const uId = u._id.toString();
      conversationPartners[uId] = {
        id: uId,
        name: u.firstName || u.name || null,
        image: u.profileImage || null,
        isOnline: checkIsOnline(u),
        lastSeen: u.lastSeen,
      };
    });

    const formattedMessages = messages.map((msg) => {
      const msgObj = msg.toObject ? msg.toObject() : { ...msg };
      const isStarredByMe = Array.isArray(msgObj.starredBy)
        ? msgObj.starredBy.some((id) => id.toString() === currentUserIdStr)
        : false;
      return {
        ...msgObj,
        starredBy: Array.isArray(msgObj.starredBy) ? msgObj.starredBy : [],
        isStarred: isStarredByMe,
      };
    });

    return res.status(200).json({ messages: formattedMessages, conversationPartners });
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
    const currentUserId = req.user?._id;
    const { selectedUserId } = req.params;

    if (!selectedUserId || selectedUserId === 'undefined' || selectedUserId === 'null' || !mongoose.Types.ObjectId.isValid(selectedUserId)) {
      return res.status(200).json({
        success: true,
        messages: [],
        isBlockedByMe: false,
        isBlockedByOther: false,
      });
    }

    const selObjectId = new mongoose.Types.ObjectId(selectedUserId);

    // Automatically mark all unread chat notifications & messages from this sender as read/seen
    Notification.updateMany(
      { recipient: currentUserId, sender: selObjectId, type: 'chat', isRead: false },
      { isRead: true }
    ).catch(() => { });

    Message.updateMany(
      { senderId: selObjectId, receiverId: currentUserId, status: { $ne: 'seen' } },
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
    }).catch(() => { });

    const curObjId = mongoose.Types.ObjectId.isValid(currentUserId) ? new mongoose.Types.ObjectId(currentUserId) : null;
    const curStr = currentUserId ? currentUserId.toString() : null;
    const currentMatches = [curObjId, curStr].filter(Boolean);
    const selectedMatches = [selObjectId, selectedUserId ? selectedUserId.toString() : null].filter(Boolean);

    const messages = await Message.find({
      $or: [
        { senderId: { $in: currentMatches }, receiverId: { $in: selectedMatches }, deletedBySender: { $ne: true } },
        { senderId: { $in: selectedMatches }, receiverId: { $in: currentMatches }, deletedByReceiver: { $ne: true } }
      ]
    }).sort({ createdAt: 1 });

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

    const partnerUser = await User.findById(selObjectId).select('firstName name profileImage isLoggedIn isOnline lastSeen').lean();

    const isPartnerOnline = partnerUser ? checkIsOnline(partnerUser) : false;
    const partnerLastSeen = partnerUser?.lastSeen ? new Date(partnerUser.lastSeen) : null;
    const currentUserName = req.user?.firstName || req.user?.name || 'User';
    const partnerName = partnerUser ? (partnerUser.firstName || partnerUser.name || 'User') : 'Unknown';

    const uIdStr = selObjectId.toString();
    const hasSocket = global.onlineUsers ? global.onlineUsers.has(uIdStr) : false;
    const lastPing = global.userLastPing ? global.userLastPing.get(uIdStr) : null;
    const hasPing = !!(lastPing && (Date.now() - lastPing < 35000));

    console.log(`\n======================================================`);
    console.log(`💬 [CHATTING SCREEN OPENED - HTTP]`);
    console.log(`👤 Logged-in User (Viewer): "${currentUserName}" (ID: ${currentUserId})`);
    console.log(`💬 Chat Partner (Target):   "${partnerName}" (ID: ${selObjectId})`);
    console.log(`📱 DISPLAYED ON CHAT SCREEN FOR LOGGED-IN USER:`);
    console.log(`   👉 Partner Status: ${isPartnerOnline ? 'Online 🟢' : `Offline 🔴 (Last Seen: ${partnerLastSeen ? partnerLastSeen.toLocaleTimeString() : 'N/A'})`}`);
    console.log(`📋 Partner Presence Breakdown:`);
    console.log(`   ├─ Cond 1 (Logged In in DB):  ${partnerUser?.isLoggedIn === true ? '✅ Yes' : '❌ No'} (isLoggedIn: ${partnerUser?.isLoggedIn}, isOnline: ${partnerUser?.isOnline})`);
    console.log(`   ├─ Cond 2 (Active Socket):    ${hasSocket ? '✅ Yes' : '❌ No'}`);
    console.log(`   └─ Cond 3 (Network Ping):     ${hasPing ? '✅ Yes' : '❌ No'}`);
    console.log(`   => Conclusion: ${isPartnerOnline ? 'Partner is active on app with network -> displays "Online 🟢"' : 'Partner closed app/disconnected -> displays "Offline 🔴"'}`);
    console.log(`======================================================\n`);

    const currentUserIdStr = currentUserId.toString();
    const formattedMessages = messages.map((msg) => {
      const msgObj = msg.toObject ? msg.toObject() : { ...msg };
      const isStarredByMe = Array.isArray(msgObj.starredBy)
        ? msgObj.starredBy.some((id) => id.toString() === currentUserIdStr)
        : false;
      return {
        ...msgObj,
        starredBy: Array.isArray(msgObj.starredBy) ? msgObj.starredBy : [],
        isStarred: isStarredByMe,
      };
    });

    return res.status(200).json({
      success: true,
      messages: formattedMessages,
      isBlockedByMe,
      isBlockedByOther,
      partner: partnerUser ? {
        id: partnerUser._id.toString(),
        name: partnerName,
        image: partnerUser.profileImage || null,
        isOnline: isPartnerOnline,
        lastSeen: partnerUser.lastSeen || null,
      } : null,
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
 * Delete a message.
 * - deleteForEveryone=true  → hard-delete from DB, notify both sender & receiver via socket
 * - deleteForEveryone=false → "delete for me" — marks deletedBySender=true (only hides for sender)
 */
exports.deleteMessage = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { messageId } = req.params;
    const deleteForEveryone = req.body?.deleteForEveryone === true || req.query?.deleteForEveryone === 'true';

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found.' });
    }

    const isSender = message.senderId.toString() === currentUserId.toString();
    const isReceiver = message.receiverId.toString() === currentUserId.toString();

    if (!isSender && !isReceiver) {
      return res.status(403).json({ message: 'You are not authorized to delete this message.' });
    }

    const io = req.app.get('io');

    if (deleteForEveryone) {
      // Only the original sender can delete for everyone
      if (!isSender) {
        return res.status(403).json({ message: 'Only the sender can delete a message for everyone.' });
      }

      const receiverId = message.receiverId.toString();
      message.isDeletedForEveryone = true;
      message.text = 'This message was deleted';
      message.mediaUrl = null;
      message.fileName = null;
      message.fileSize = null;
      message.reactions = [];
      await message.save();

      // Notify both sender and receiver to update the message in their UI
      if (io) {
        const payload = {
          messageId: messageId.toString(),
          senderId: currentUserId.toString(),
          receiverId,
          deleteType: 'everyone',
          deletedForEveryone: true,
          text: 'This message was deleted',
        };
        io.to(currentUserId.toString()).emit('message_deleted', payload);
        io.to(receiverId).emit('message_deleted', payload);
        const onlineUsers = global.onlineUsers || new Map();
        const rSocketId = onlineUsers.get(receiverId);
        if (rSocketId) io.to(rSocketId).emit('message_deleted', payload);
      }

      return res.status(200).json({ message: 'Message deleted for everyone.', messageId, deletedForEveryone: true, isDeletedForEveryone: true });
    } else {
      // Delete for me only — mark the appropriate flag
      if (isSender) {
        await Message.findByIdAndUpdate(messageId, { $set: { deletedBySender: true } });
      } else {
        await Message.findByIdAndUpdate(messageId, { $set: { deletedByReceiver: true } });
      }

      // Notify only the current user's own sockets to remove from UI
      if (io) {
        io.to(currentUserId.toString()).emit('message_deleted', {
          messageId: messageId.toString(),
          senderId: currentUserId.toString(),
          deletedForEveryone: false,
        });
      }

      return res.status(200).json({ message: 'Message deleted for you.', messageId, deletedForEveryone: false });
    }
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

    if (!selectedUserId || selectedUserId === 'undefined' || selectedUserId === 'null') {
      return res.status(400).json({ message: 'Valid selectedUserId is required.' });
    }

    const curObjId = mongoose.Types.ObjectId.isValid(currentUserId) ? new mongoose.Types.ObjectId(currentUserId) : null;
    const curStr = currentUserId ? currentUserId.toString() : null;
    const selObjId = mongoose.Types.ObjectId.isValid(selectedUserId) ? new mongoose.Types.ObjectId(selectedUserId) : null;
    const selStr = selectedUserId ? selectedUserId.toString() : null;

    const currentMatches = [curObjId, curStr].filter(Boolean);
    const selectedMatches = [selObjId, selStr].filter(Boolean);

    await Message.updateMany(
      {
        senderId: { $in: currentMatches },
        receiverId: { $in: selectedMatches },
      },
      { $set: { deletedBySender: true } }
    );

    await Message.updateMany(
      {
        senderId: { $in: selectedMatches },
        receiverId: { $in: currentMatches },
      },
      { $set: { deletedByReceiver: true } }
    );

    await Message.deleteMany({
      $or: [
        { senderId: { $in: currentMatches }, receiverId: { $in: selectedMatches } },
        { senderId: { $in: selectedMatches }, receiverId: { $in: currentMatches } },
      ],
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
/**
 * Stream a binary buffer with full HTTP Range request support (essential for audio/video seeking)
 */
const streamMediaBuffer = (req, res, buffer, mimeType) => {
  if (!buffer || !buffer.length) {
    return res.status(404).send('Media data empty or not found');
  }
  const total = buffer.length;
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const partialStart = parts[0];
    const partialEnd = parts[1];

    const start = parseInt(partialStart, 10);
    const end = partialEnd ? parseInt(partialEnd, 10) : total - 1;

    if (start >= total || end >= total || start > end) {
      res.setHeader('Content-Range', `bytes */${total}`);
      return res.status(416).send('Requested range not satisfiable');
    }

    const chunksize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', chunksize);
    return res.end(buffer.subarray(start, end + 1));
  } else {
    res.setHeader('Content-Length', total);
    return res.end(buffer);
  }
};

/**
 * Stream Chat Media by MongoDB ID
 */
exports.getChatMediaById = async (req, res) => {
  try {
    const { mediaId } = req.params;
    if (!mediaId || !mongoose.Types.ObjectId.isValid(mediaId)) {
      return res.status(404).json({ success: false, message: 'Invalid media ID' });
    }
    const media = await ChatMedia.findById(mediaId);
    if (!media || !media.data) {
      return res.status(404).json({ success: false, message: 'Media not found' });
    }
    return streamMediaBuffer(req, res, media.data, media.mimeType);
  } catch (error) {
    console.error('Error streaming chat media by id:', error);
    return res.status(500).json({ success: false, message: 'Error streaming media' });
  }
};

/**
 * Stream Chat Media by filename (looks in local /uploads and MongoDB ChatMedia)
 */
exports.getChatMediaByName = async (req, res) => {
  try {
    const { filename } = req.params;
    if (!filename) {
      return res.status(404).json({ success: false, message: 'No filename specified' });
    }

    // 1. Check local uploads folder first
    const localUploadsDir = path.join(__dirname, '../../uploads');
    const localFilePath = path.join(localUploadsDir, filename);
    if (fs.existsSync(localFilePath)) {
      const ext = path.extname(filename).toLowerCase();
      let mimeType = 'application/octet-stream';
      if (['.mp4', '.m4a'].includes(ext)) mimeType = 'audio/mp4';
      else if (['.mp3'].includes(ext)) mimeType = 'audio/mpeg';
      else if (['.wav'].includes(ext)) mimeType = 'audio/wav';
      else if (['.jpg', '.jpeg'].includes(ext)) mimeType = 'image/jpeg';
      else if (['.png'].includes(ext)) mimeType = 'image/png';
      else if (['.pdf'].includes(ext)) mimeType = 'application/pdf';

      const fileBuffer = fs.readFileSync(localFilePath);
      return streamMediaBuffer(req, res, fileBuffer, mimeType);
    }

    // 2. Fallback to MongoDB ChatMedia
    const media = await ChatMedia.findOne({ fileName: filename });
    if (media && media.data) {
      return streamMediaBuffer(req, res, media.data, media.mimeType);
    }

    return res.status(404).json({ success: false, message: 'Media file not found' });
  } catch (error) {
    console.error('Error streaming chat media by name:', error);
    return res.status(500).json({ success: false, message: 'Error streaming media' });
  }
};

/**
 * Upload chat media (voice notes, audio, images, documents)
 * Saves to Cloudinary if available, with permanent fallback to MongoDB ChatMedia.
 */
exports.uploadChatMedia = async (req, res) => {
  try {
    const file = req.file || (req.files && req.files.length > 0 ? req.files[0] : null);
    const bodyFile = req.body?.file || req.body?.image || req.body?.photo || req.body?.base64;

    if (!file && !bodyFile) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    let mediaUrl = null;
    let originalName = file?.originalname || 'chat_file';
    let size = file?.size || 0;

    const lowerName = originalName.toLowerCase();
    const mime = (file?.mimetype || '').toLowerCase();
    const isVoiceName = lowerName.startsWith('voice_') || lowerName.includes('voice_');
    const isAudio = mime.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|opus)$/i.test(lowerName) || isVoiceName;
    const isVideo = !isAudio && (mime.startsWith('video/') || /\.(mp4|mov|webm|3gp|mkv|avi|m4v|flv)$/i.test(lowerName));

    // Resolve file buffer from either memory, disk path, or Base64 body
    let fileBuffer = null;
    if (file && file.buffer) {
      fileBuffer = file.buffer;
    } else if (file && file.path && fs.existsSync(file.path)) {
      try {
        fileBuffer = fs.readFileSync(file.path);
        if (!size) size = fileBuffer.length;
      } catch (readErr) {
        console.warn('[uploadChatMedia] Failed to read file from path:', readErr.message);
      }
    } else if (bodyFile && typeof bodyFile === 'string' && bodyFile.startsWith('data:')) {
      try {
        const matches = bodyFile.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
        if (matches && matches[2]) {
          fileBuffer = Buffer.from(matches[2], 'base64');
          if (!size) size = fileBuffer.length;
        }
      } catch (_) { }
    }

    const doCloudinaryUpload = async (inputData) => {
      // 1. Video handling
      if (isVideo) {
        try {
          console.log(`[ChatMedia] Uploading video to Cloudinary via upload_large...`);
          const cloudRes = await cloudinary.uploader.upload_large(inputData, {
            folder: 'dating_app_chat_media',
            resource_type: 'video',
            chunk_size: 6000000,
            timeout: 25000,
          });
          if (cloudRes && cloudRes.secure_url) {
            return cloudRes.secure_url;
          }
        } catch (vErr) {
          console.warn('[ChatMedia] Cloudinary video signed upload failed:', vErr.message || vErr);
        }
        return null;
      }

      // 2. Non-video handling (Photos, Audio, Documents)
      let resourceType = isAudio ? 'video' : mime.startsWith('image/') ? 'image' : 'raw';
      const typesToTry = [resourceType, 'auto', 'raw'].filter((v, idx, arr) => arr.indexOf(v) === idx);

      for (const resType of typesToTry) {
        try {
          console.log(`[ChatMedia] Uploading to Cloudinary with resource_type='${resType}'...`);
          const cloudRes = await cloudinary.uploader.upload(inputData, {
            folder: 'dating_app_chat_media',
            resource_type: resType,
            public_id: isAudio ? `voice_${Date.now()}_${Math.round(Math.random() * 1e6)}` : undefined,
            timeout: 25000,
          });
          if (cloudRes && cloudRes.secure_url) {
            return cloudRes.secure_url;
          }
        } catch (err1) {
          console.warn(`[ChatMedia] Cloudinary upload (${resType}) failed:`, err1.message || err1);
        }
      }
      return null;
    };

    if (file && file.path) {
      mediaUrl = await doCloudinaryUpload(file.path);
    } else if (fileBuffer) {
      const mimeType = mime || (isAudio ? 'audio/mp4' : isVideo ? 'video/mp4' : 'application/octet-stream');
      const base64Str = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
      mediaUrl = await doCloudinaryUpload(base64Str);
    }

    // If Cloudinary succeeded and file was on disk, clean up temp file
    if (mediaUrl && file && file.path && fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path); } catch (e) { }
    }

    // If Cloudinary was unavailable (e.g. 403 Forbidden, quota reached, network issue),
    // save media directly into MongoDB ChatMedia so it is 100% permanently preserved
    // and streamable across all environments (Vercel serverless and Localhost)!
    let mediaId = null;
    if (!mediaUrl && fileBuffer && fileBuffer.length > 0) {
      try {
        const generatedFilename = file?.filename || `upload_${Date.now()}_${Math.round(Math.random() * 1e9)}${path.extname(originalName) || (isAudio ? '.mp4' : '.jpg')}`;
        const finalMime = mime || (isAudio ? 'audio/mp4' : isVideo ? 'video/mp4' : 'application/octet-stream');

        const chatMedia = new ChatMedia({
          fileName: generatedFilename,
          originalName: originalName,
          mimeType: finalMime,
          size: fileBuffer.length,
          data: fileBuffer,
          uploadedBy: req.user?._id,
        });
        await chatMedia.save();
        mediaId = chatMedia._id;

        // Generate reliable streaming endpoint URL
        const protoHeader = req.headers['x-forwarded-proto'];
        let protocol = protoHeader ? protoHeader.split(',')[0].trim() : (req.protocol || 'http');
        let host = req.get('host') || 'localhost:5000';
        if (host.includes('vercel.app')) {
          protocol = 'https';
        }

        mediaUrl = `${protocol}://${host}/api/chat/media/${chatMedia._id}`;
        console.log('✅ [uploadChatMedia] Saved media to MongoDB ChatMedia with streaming URL:', mediaUrl);
      } catch (mongoErr) {
        console.error('[uploadChatMedia] Failed saving media to MongoDB ChatMedia:', mongoErr);
      }
    }

    // Secondary fallback: local disk URL if file.path still exists
    if (!mediaUrl && file && file.path) {
      const filename = path.basename(file.path);
      const protoHeader = req.headers['x-forwarded-proto'];
      let protocol = protoHeader ? protoHeader.split(',')[0].trim() : (req.protocol || 'http');
      let host = req.get('host') || 'localhost:5000';
      if (host.includes('vercel.app')) protocol = 'https';
      mediaUrl = `${protocol}://${host}/uploads/${filename}`;
      console.log('[uploadChatMedia] Using local /uploads/ fallback URL:', mediaUrl);
    }

    if (!mediaUrl) {
      return res.status(500).json({ success: false, message: 'Failed to upload chat media to server.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Chat media uploaded successfully',
      url: mediaUrl,
      fileName: originalName,
      fileSize: size || (fileBuffer ? fileBuffer.length : 0),
      mediaId: mediaId,
    });
  } catch (error) {
    console.error('Chat media upload error:', error);
    return res.status(500).json({ success: false, message: 'Server error during chat media upload.', error: error.message });
  }
};

/**
 * Send a chat message (REST API Fallback for Vercel/Serverless environments)
 */
exports.sendMessage = async (req, res) => {
  try {
    const senderId = req.user._id;
    const { receiverId, text, messageType, mediaUrl, fileName, fileSize, stickerId, tempId, replyTo, isForwarded } = req.body;

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

    // Deduplicate only by unique tempId if provided (never by text alone)
    if (tempId) {
      const existingMessage = await Message.findOne({ tempId: tempId });
      if (existingMessage) {
        console.log(`[REST sendMessage] Deduplicated duplicate message call for tempId: ${tempId}`);
        return res.status(200).json({
          message: 'Message sent (deduplicated)',
          data: existingMessage,
        });
      }
    }

    let parsedReplyTo = replyTo;
    if (typeof replyTo === 'string') {
      try {
        parsedReplyTo = JSON.parse(replyTo);
      } catch (e) {
        parsedReplyTo = null;
      }
    }
    if (parsedReplyTo && (!parsedReplyTo.text && !parsedReplyTo.mediaUrl && !parsedReplyTo.fileName && !parsedReplyTo.stickerId)) {
      parsedReplyTo = null;
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
      tempId: tempId || null,
      replyTo: parsedReplyTo || null,
      isForwarded: Boolean(isForwarded),
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
      replyTo: newMessage.replyTo || replyTo || null,
      isForwarded: Boolean(newMessage.isForwarded),
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

    let notificationText = ' Sent a message';
    let notificationTitle = ` ${senderName}`;

    if (messageType === 'voice') {
      notificationTitle = ` Voice Message from ${senderName}`;
      notificationText = ' Sent a voice note / audio message';
    } else if (messageType === 'call') {
      notificationTitle = ` Voice Call from ${senderName}`;
      notificationText = text || ' Voice call';
    } else if (messageType === 'image') {
      notificationText = ' Sent a photo';
    } else if (messageType === 'video') {
      notificationText = ' Sent a video';
    } else if (messageType === 'document') {
      notificationText = ' Sent a document';
    } else if (messageType === 'sticker') {
      notificationText = ' Sent a sticker';
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

/**
 * Edit an existing sent message text
 */
exports.editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text } = req.body;
    const currentUserId = req.user._id.toString();

    if (!messageId || !text || !text.trim()) {
      return res.status(400).json({ message: 'Message ID and non-empty text are required.' });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found.' });
    }

    if (message.senderId.toString() !== currentUserId) {
      return res.status(403).json({ message: 'You can only edit your own messages.' });
    }

    message.text = text.trim();
    message.isEdited = true;
    await message.save();

    const io = req.app.get('io');
    if (io) {
      const editPayload = {
        messageId: message._id.toString(),
        senderId: currentUserId,
        receiverId: message.receiverId.toString(),
        text: message.text,
        isEdited: true,
      };
      io.to(message.receiverId.toString()).emit('message_edited', editPayload);
      const onlineUsers = global.onlineUsers || new Map();
      const receiverSocketId = onlineUsers.get(message.receiverId.toString());
      if (receiverSocketId) io.to(receiverSocketId).emit('message_edited', editPayload);
    }

    return res.status(200).json({
      success: true,
      message: 'Message edited successfully',
      data: message,
    });
  } catch (error) {
    console.error('Edit message error:', error);
    return res.status(500).json({ message: 'Server error while editing message.' });
  }
};

/**
 * React to a message with an emoji (WhatsApp style emoji reaction with MongoDB persistence)
 */
exports.reactToMessage = async (req, res) => {
  try {
    const currentUserId = req.user?._id;
    const { messageId } = req.params;
    const { emoji, receiverId, action } = req.body;

    if (!emoji && action !== 'remove') {
      return res.status(400).json({ message: 'Emoji is required.' });
    }
    if (!messageId) {
      return res.status(400).json({ message: 'Message ID is required.' });
    }

    let msg = null;
    if (mongoose.Types.ObjectId.isValid(messageId)) {
      msg = await Message.findById(messageId);
    }
    if (!msg) {
      msg = await Message.findOne({ tempId: messageId });
    }

    if (!msg) {
      return res.status(404).json({ message: 'Message not found.' });
    }

    const uIdStr = currentUserId.toString();
    if (!Array.isArray(msg.reactions)) {
      msg.reactions = [];
    }

    const existingIdx = msg.reactions.findIndex(
      (r) => r.userId && r.userId.toString() === uIdStr
    );

    if (action === 'remove') {
      if (existingIdx > -1) {
        msg.reactions.splice(existingIdx, 1);
      }
    } else if (action === 'set' || action === 'add') {
      if (existingIdx > -1) {
        msg.reactions[existingIdx].emoji = emoji;
      } else {
        msg.reactions.push({ userId: currentUserId, emoji });
      }
    } else {
      // Default toggle behavior
      if (existingIdx > -1) {
        if (msg.reactions[existingIdx].emoji === emoji) {
          msg.reactions.splice(existingIdx, 1);
        } else {
          msg.reactions[existingIdx].emoji = emoji;
        }
      } else {
        msg.reactions.push({ userId: currentUserId, emoji });
      }
    }

    await msg.save();

    const targetReceiverId = (receiverId || (msg.senderId.toString() === uIdStr ? msg.receiverId.toString() : msg.senderId.toString()))?.toString();
    const payload = {
      messageId: msg._id.toString(),
      tempId: msg.tempId || messageId,
      reactions: msg.reactions,
      senderId: uIdStr,
      receiverId: targetReceiverId,
      emoji,
    };

    const io = req.app.get('io');
    if (io) {
      io.to(uIdStr).emit('message_reaction_updated', payload);
      if (targetReceiverId) {
        io.to(targetReceiverId).emit('message_reaction_updated', payload);
        const onlineUsers = global.onlineUsers || new Map();
        const rSocketId = onlineUsers.get(targetReceiverId);
        if (rSocketId) io.to(rSocketId).emit('message_reaction_updated', payload);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Reaction updated successfully',
      reactions: msg.reactions,
      messageId: msg._id.toString(),
      tempId: msg.tempId || messageId,
    });
  } catch (error) {
    console.error('reactToMessage error:', error);
    return res.status(500).json({ message: 'Server error while reacting to message.' });
  }
};

/**
 * Pin or unpin a message
 */
exports.pinMessage = async (req, res) => {
  try {
    const currentUserId = req.user?._id;
    const { messageId } = req.params;
    const { isPinned, receiverId } = req.body;

    let msg = null;
    if (mongoose.Types.ObjectId.isValid(messageId)) {
      msg = await Message.findById(messageId);
    }
    if (!msg) {
      msg = await Message.findOne({ tempId: messageId });
    }

    if (!msg) {
      return res.status(404).json({ message: 'Message not found.' });
    }

    msg.isPinned = !!isPinned;
    msg.pinnedBy = isPinned ? currentUserId : null;
    await msg.save();

    if (isPinned) {
      // WhatsApp single-pin rule: unpin other messages in this conversation
      await Message.updateMany(
        {
          $or: [
            { senderId: msg.senderId, receiverId: msg.receiverId },
            { senderId: msg.receiverId, receiverId: msg.senderId },
          ],
          _id: { $ne: msg._id },
          isPinned: true,
        },
        { isPinned: false, pinnedBy: null }
      );
    }

    const uIdStr = currentUserId.toString();
    const targetReceiverId = (receiverId || (msg.senderId.toString() === uIdStr ? msg.receiverId.toString() : msg.senderId.toString()))?.toString();
    const payload = {
      messageId: msg._id.toString(),
      tempId: msg.tempId || messageId,
      isPinned: msg.isPinned,
      senderId: uIdStr,
      receiverId: targetReceiverId,
    };

    const io = req.app.get('io');
    if (io) {
      io.to(uIdStr).emit('message_pinned_updated', payload);
      if (targetReceiverId) {
        io.to(targetReceiverId).emit('message_pinned_updated', payload);
        const onlineUsers = global.onlineUsers || new Map();
        const rSocketId = onlineUsers.get(targetReceiverId);
        if (rSocketId) io.to(rSocketId).emit('message_pinned_updated', payload);
      }
    }

    return res.status(200).json({
      success: true,
      isPinned: msg.isPinned,
      messageId: msg._id.toString(),
    });
  } catch (error) {
    console.error('pinMessage error:', error);
    return res.status(500).json({ message: 'Server error while pinning message.' });
  }
};

exports.starMessage = async (req, res) => {
  try {
    const currentUserId = req.user?._id;
    const { messageId } = req.params;
    const { isStarred, receiverId } = req.body;

    let msg = null;
    if (mongoose.Types.ObjectId.isValid(messageId)) {
      msg = await Message.findById(messageId);
    }
    if (!msg) {
      msg = await Message.findOne({ tempId: messageId });
    }

    if (!msg) {
      return res.status(404).json({ message: 'Message not found.' });
    }

    if (!Array.isArray(msg.starredBy)) {
      msg.starredBy = [];
    }

    const uIdStr = currentUserId.toString();
    const isAlreadyStarred = msg.starredBy.some((id) => id.toString() === uIdStr);

    if (isStarred && !isAlreadyStarred) {
      msg.starredBy.push(currentUserId);
    } else if (!isStarred && isAlreadyStarred) {
      msg.starredBy = msg.starredBy.filter((id) => id.toString() !== uIdStr);
    }

    msg.isStarred = msg.starredBy.length > 0;
    await msg.save();

    const payload = {
      messageId: msg._id.toString(),
      tempId: msg.tempId || messageId,
      isStarred: !!isStarred,
      senderId: uIdStr,
      userId: uIdStr,
      receiverId: receiverId ? receiverId.toString() : '',
      starredBy: (msg.starredBy || []).map(id => id.toString()),
      mediaUrl: msg.mediaUrl,
      messageType: msg.messageType,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
    };

    // In WhatsApp, starring is strictly private to the user who performed the star action.
    // Emit ONLY to the user who starred/unstarred the message (uIdStr), NEVER to the chat partner!
    const io = req.app.get('io');
    if (io) {
      io.to(uIdStr).emit('message_star_updated', payload);
      const onlineUsers = global.onlineUsers || new Map();
      const sSocketId = onlineUsers.get(uIdStr);
      if (sSocketId) io.to(sSocketId).emit('message_star_updated', payload);
    }

    return res.status(200).json({
      success: true,
      isStarred: !!isStarred,
      starredBy: (msg.starredBy || []).map(id => id.toString()),
      messageId: msg._id.toString(),
    });
  } catch (error) {
    console.error('starMessage error:', error);
    return res.status(500).json({ message: 'Server error while starring message.' });
  }
};


