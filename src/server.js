const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (e) {
  // Ignore if custom DNS fails
}

const express = require('express');
const cors = require('cors');

const mongoose = require('mongoose');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const Message = require('./models/Message');
const User = require('./models/User');
const Block = require('./models/Block');
const Notification = require('./models/Notification');
const { sendPushNotification } = require('./services/pushNotificationService');

require('dotenv').config({ override: true });

const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO with mobile network ping configuration
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
});

app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Invalid JSON format in request body.' });
  }
  if (err && err.status === 413) {
    return res.status(413).json({ message: 'Uploaded video file size is too large (max 100MB allowed).' });
  }
  next(err);
});
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Database Connection & Permanent Pool Configuration
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/Dating_App';

// Enable Mongoose query buffering so operations wait for pool connection instead of dropping queries
mongoose.set('bufferCommands', true);

const mongooseOptions = {
  serverSelectionTimeoutMS: 10000,
  maxPoolSize: 25,
  minPoolSize: 5,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  heartbeatFrequencyMS: 10000,
};

mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Connection lost. Reconnecting immediately...');
  mongoose.connect(mongoURI, mongooseOptions).catch((err) => {
    console.error('[MongoDB] Reconnection attempt error:', err.message);
  });
});

mongoose.connection.on('error', (err) => {
  console.error('[MongoDB] Socket error:', err.message);
});

if (mongoose.connection.readyState === 0) {
  mongoose
    .connect(mongoURI, mongooseOptions)
    .then(async () => {
      console.log('Successfully connected to MongoDB with permanent connection pool.');
      try {
        await User.updateMany(
          { 'currentLocation.location': { $exists: true }, 'currentLocation.location.coordinates': { $exists: false } },
          { $unset: { currentLocation: 1 } }
        );
        await User.updateMany(
          { 'permanentAddress.location': { $exists: true }, 'permanentAddress.location.coordinates': { $exists: false } },
          { $unset: { 'permanentAddress.location': 1 } }
        );
        await User.updateMany(
          { location: { $exists: true }, 'location.coordinates': { $exists: false } },
          { $unset: { location: 1 } }
        );
        console.log('Successfully sanitized existing geo-location documents in database.');
      } catch (cleanErr) {
        console.error('Geo cleanup error:', cleanErr);
      }
    })
    .catch((err) => console.error('MongoDB connection error:', err));
}

// Routes
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const chatRoutes = require('./routes/chatRoutes');
const matchRoutes = require('./routes/matchRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const searchRoutes = require('./routes/searchRoutes');
const questionnaireRoutes = require('./routes/questionnaireRoutes');

app.use('/api/auth', authRoutes);
app.use(['/api/profile', '/api/profil'], profileRoutes);
app.use('/api/questionnaire', questionnaireRoutes);
app.use('/api/questionnaires', questionnaireRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/match', matchRoutes);
app.use('/api/user', matchRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);

// Health Check Routes
app.get(['/', '/health', '/api/health'], (req, res) => {
  const dbStatusMap = {
    0: 'Disconnected',
    1: 'Connected',
    2: 'Connecting',
    3: 'Disconnecting',
  };
  res.status(200).json({
    status: 'OK',
    message: 'Dating App Backend is healthy and running!',
    timestamp: new Date().toISOString(),
    database: dbStatusMap[mongoose.connection.readyState] || 'Unknown',
    uptimeSeconds: Math.floor(process.uptime()),
  });
});


// Store socket mappings: userId -> socket.id
const onlineUsers = new Map();
global.onlineUsers = onlineUsers;

// Socket.IO Logic
io.on('connection', (socket) => {
  console.log('Socket client connected:', socket.id);

  // User joins and registers their userId
  socket.on('join', async (userId) => {
    if (userId) {
      const uIdStr = userId.toString();
      const now = new Date();
      onlineUsers.set(uIdStr, socket.id);
      console.log(`User ${userId} associated with socket ${socket.id}`);
      
      // Update DB isLoggedIn status & lastSeen
      try {
        await User.findByIdAndUpdate(uIdStr, { isLoggedIn: true, lastSeen: now });
      } catch (dbErr) {
        console.error(`Failed to update isLoggedIn for user ${userId}:`, dbErr);
      }

      // Broadcast online status to all clients
      io.emit('user_status', { userId: uIdStr, status: 'online' });

      // Send list of all currently online users to the newly joined user
      socket.emit('online_users_list', {
        onlineUserIds: Array.from(onlineUsers.keys()),
      });

      // Mark pending 'sent' messages as 'delivered' for this user upon connecting
      try {
        const undeliveredMsgs = await Message.find({ receiverId: userId, status: 'sent' });
        if (undeliveredMsgs.length > 0) {
          await Message.updateMany({ receiverId: userId, status: 'sent' }, { status: 'delivered' });
          undeliveredMsgs.forEach((msg) => {
            const senderSocketId = onlineUsers.get(msg.senderId.toString());
            if (senderSocketId) {
              io.to(senderSocketId).emit('message_delivered', {
                messageId: msg._id.toString(),
                receiverId: userId.toString(),
                status: 'delivered',
              });
            }
          });
        }
      } catch (err) {
        console.error('Error updating undelivered messages on socket join:', err);
      }
    }
  });

  // Real-time presence ping handler
  socket.on('ping_presence', async (userId) => {
    if (userId) {
      const uIdStr = userId.toString();
      const now = new Date();
      onlineUsers.set(uIdStr, socket.id);
      try {
        await User.findByIdAndUpdate(uIdStr, { isLoggedIn: true, lastSeen: now });
      } catch (dbErr) {}
    }
  });

  // Real-time explicit offline handler (app minimized/backgrounded or logged out)
  socket.on('going_offline', async (userId) => {
    if (userId) {
      const uIdStr = userId.toString();
      onlineUsers.delete(uIdStr);
      const lastSeenDate = new Date();
      try {
        await User.findByIdAndUpdate(uIdStr, { isLoggedIn: false, lastSeen: lastSeenDate });
      } catch (dbErr) {}

      io.emit('user_status', {
        userId: uIdStr,
        status: 'offline',
        lastSeen: lastSeenDate.toISOString(),
      });
    }
  });

  // Handle explicitly checking online status of a partner user (strictly onlineUsers socket presence)
  socket.on('check_online_status', async ({ targetUserId }) => {
    if (!targetUserId) return;
    const targetIdStr = targetUserId.toString();
    const isOnline = onlineUsers.has(targetIdStr);
    let lastSeen = null;

    if (!isOnline) {
      try {
        const targetUser = await User.findById(targetUserId).select('lastSeen');
        if (targetUser && targetUser.lastSeen) {
          lastSeen = targetUser.lastSeen.toISOString();
        }
      } catch (err) {
        console.error('Error fetching lastSeen for target user:', err);
      }
    }

    socket.emit('online_status_response', {
      targetUserId: targetIdStr,
      isOnline,
      lastSeen,
    });
  });

  // Handle sending one-to-one message
  socket.on('send_message', async ({ senderId, receiverId, text, messageType, mediaUrl, fileName, fileSize, stickerId, tempId }) => {
    try {
      if (!senderId || !receiverId) return;
      if (!text && !mediaUrl && !stickerId) return;

      const receiverSocketId = onlineUsers.get(receiverId.toString());
      const initialStatus = receiverSocketId ? 'delivered' : 'sent';

      const newMessage = new Message({
        senderId,
        receiverId,
        text,
        messageType: messageType || 'text',
        mediaUrl,
        fileName,
        fileSize,
        stickerId,
        status: initialStatus
      });
      await newMessage.save();

      const senderUser = await User.findById(senderId).select('firstName name');
      const senderName = senderUser?.firstName || senderUser?.name || 'Someone';

      const msgData = {
        _id: newMessage._id,
        senderId: senderId.toString(),
        receiverId: receiverId.toString(),
        senderName,
        text: newMessage.text,
        messageType: newMessage.messageType,
        mediaUrl: newMessage.mediaUrl,
        fileName: newMessage.fileName,
        fileSize: newMessage.fileSize,
        stickerId: newMessage.stickerId,
        status: newMessage.status,
        createdAt: newMessage.createdAt,
        tempId: tempId || null
      };

      // Emit to receiver if online
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_message', msgData);
        console.log(`Socket: Message sent and delivered from ${senderId} to online receiver ${receiverId}`);
        // Notify sender that it has been delivered
        socket.emit('message_delivered', { messageId: newMessage._id.toString(), tempId: tempId || null, receiverId: receiverId.toString(), status: 'delivered' });
      } else {
        console.log(`Socket: Message sent as pending from ${senderId} to offline receiver ${receiverId}`);
      }

      // Confirm send back to sender
      socket.emit('message_sent', msgData);

      // Trigger FCM Push Notification for Receiver
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
        }
      }).catch(err => console.error('Chat FCM push error:', err));
    } catch (err) {
      console.error('Error handling send_message socket event:', err);
    }
  });

  // Handle marking messages as seen
  socket.on('mark_seen', async ({ senderId, receiverId }) => {
    try {
      if (!senderId || !receiverId) return;

      const result = await Message.updateMany(
        {
          senderId: senderId,
          receiverId: receiverId,
          status: { $ne: 'seen' }
        },
        {
          $set: { status: 'seen' }
        }
      );

      console.log(`Socket: Marked messages as seen between sender ${senderId} and receiver ${receiverId}. Count:`, result.modifiedCount);

      // Also mark corresponding Notification records as read
      await Notification.updateMany(
        { recipient: receiverId, sender: senderId, isRead: false },
        { isRead: true }
      );

      // If sender is online, notify them in real-time that their messages were seen
      const senderSocketId = onlineUsers.get(senderId.toString());
      if (senderSocketId) {
        io.to(senderSocketId).emit('messages_seen', {
          senderId: senderId.toString(),
          receiverId: receiverId.toString(),
          status: 'seen',
        });
      }
    } catch (err) {
      console.error('Error handling mark_seen socket event:', err);
    }
  });

  // Handle typing status
  socket.on('typing', ({ senderId, receiverId }) => {
    if (!senderId || !receiverId) return;
    const receiverSocketId = onlineUsers.get(receiverId.toString());
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user_typing', { senderId: senderId.toString() });
      console.log(`Socket: User ${senderId} is typing to User ${receiverId}`);
    }
  });

  // Handle stop typing status
  socket.on('stop_typing', ({ senderId, receiverId }) => {
    if (!senderId || !receiverId) return;
    const receiverSocketId = onlineUsers.get(receiverId.toString());
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user_stop_typing', { senderId: senderId.toString() });
      console.log(`Socket: User ${senderId} stopped typing to User ${receiverId}`);
    }
  });

  // --- Voice Call Signaling ---

  // Handle calling a user
  socket.on('make_call', async ({ callerId, callerName, callerImage, receiverId, offer }) => {
    if (!callerId || !receiverId) return;
    const receiverSocketId = onlineUsers.get(receiverId.toString());

    if (receiverSocketId) {
      io.to(receiverSocketId).emit('incoming_call', {
        callerId: callerId.toString(),
        callerName,
        callerImage,
        offer
      });
      socket.emit('call_ringing', { status: 'ringing', isOnline: true });
      console.log(`Socket: Voice call offer forwarded from ${callerId} to receiver ${receiverId}`);
    } else {
      console.log(`Socket: Receiver ${receiverId} is offline for call from ${callerId}. Ringing caller & sending FCM push notification.`);

      // Emit ringing status to caller so caller's screen stays on Ringing...
      socket.emit('call_ringing', { status: 'ringing', isOnline: false });

      // 1. Save missed call message to DB so it shows in chat history
      try {
        const missedCallMsg = new Message({
          senderId: callerId,
          receiverId: receiverId,
          text: '📞 Missed voice call',
          messageType: 'call',
          mediaUrl: 'missed',
          status: 'sent'
        });
        await missedCallMsg.save();

        const msgData = {
          _id: missedCallMsg._id,
          senderId: callerId.toString(),
          receiverId: receiverId.toString(),
          text: missedCallMsg.text,
          messageType: 'call',
          mediaUrl: 'missed',
          status: 'sent',
          createdAt: missedCallMsg.createdAt
        };
        socket.emit('message_sent', msgData);
      } catch (dbErr) {
        console.error('Error saving missed call message:', dbErr);
      }

      // 2. Send high priority FCM Push Notification & DB Notification to offline receiver
      sendPushNotification(receiverId, {
        title: '📞 Incoming Voice Call',
        body: `${callerName || 'Someone'} is calling you...`,
        data: {
          type: 'incoming_call',
          senderId: callerId.toString(),
          callerName: callerName || 'Someone',
          callerImage: callerImage || ''
        }
      }).catch(err => console.error('Voice call FCM push error:', err));
    }
  });

  // Handle call acceptance
  socket.on('accept_call', ({ callerId, receiverId, answer }) => {
    if (!callerId || !receiverId) return;
    const callerSocketId = onlineUsers.get(callerId.toString());
    if (callerSocketId) {
      io.to(callerSocketId).emit('call_accepted', {
        receiverId: receiverId.toString(),
        answer
      });
      console.log(`Socket: Call accepted by ${receiverId} for caller ${callerId}`);
    }
  });

  // Handle call rejection
  socket.on('reject_call', ({ callerId, receiverId }) => {
    if (!callerId || !receiverId) return;
    const callerSocketId = onlineUsers.get(callerId.toString());
    if (callerSocketId) {
      io.to(callerSocketId).emit('call_rejected', {
        receiverId: receiverId.toString()
      });
      console.log(`Socket: Call rejected by ${receiverId} for caller ${callerId}`);
    }
  });

  // Handle ending/cancelling call
  socket.on('end_call', ({ callerId, receiverId }) => {
    if (!callerId || !receiverId) return;
    const receiverSocketId = onlineUsers.get(receiverId.toString());
    const callerSocketId = onlineUsers.get(callerId.toString());
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('call_ended', { by: callerId.toString() });
    }
    if (callerSocketId) {
      io.to(callerSocketId).emit('call_ended', { by: receiverId.toString() });
    }
    console.log(`Socket: Call ended between ${callerId} and ${receiverId}`);
  });

  // Handle ICE candidates exchange
  socket.on('webrtc_ice_candidate', ({ senderId, receiverId, candidate }) => {
    if (!senderId || !receiverId) return;
    const receiverSocketId = onlineUsers.get(receiverId.toString());
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('webrtc_ice_candidate', {
        senderId: senderId.toString(),
        candidate
      });
      console.log(`Socket: WebRTC ICE candidate forwarded from ${senderId} to ${receiverId}`);
    }
  });

  socket.on('disconnect', async () => {
    // Remove user association from onlineUsers Map
    for (const [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        console.log(`User ${userId} went offline (socket disconnected)`);

        const lastSeenDate = new Date();
        try {
          await User.findByIdAndUpdate(userId, { isLoggedIn: false, lastSeen: lastSeenDate });
        } catch (dbErr) {
          console.error(`Failed to update lastSeen for user ${userId}:`, dbErr);
        }

        // Broadcast offline status and lastSeen to all clients
        io.emit('user_status', { 
          userId: userId.toString(), 
          status: 'offline', 
          lastSeen: lastSeenDate.toISOString() 
        });
        break;
      }
    }
  });
});

// Global Express Real-Time Error Handler Middleware
app.use((err, req, res, next) => {
  console.error(`[REAL-TIME ERROR HANDLER] ${req.method} ${req.originalUrl} - Error:`, err);

  if (!res.headersSent) {
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({
      status: 'SERVER_ERROR',
      message: err.message || 'An unexpected server error occurred. Please try again.',
      ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
    });
  }
});

// Real-Time Process-Level Crash Protection
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception intercepted in real-time:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Promise Rejection intercepted in real-time:', reason);
});

// Start Server using http.Server
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;

