const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');

const JWT_SECRETS = [
  process.env.JWT_SECRET,
  'super_secret_dating_app_token_key_123!',
  'fallback_secret',
].filter(Boolean);

// Ensure MongoDB is connected before querying User model
const ensureDbConnection = async () => {
  if (mongoose.connection.readyState !== 1) {
    console.log('[AUTH MIDDLEWARE] MongoDB disconnected or connecting. Auto-reconnecting...');
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/Dating_App';
    try {
      await mongoose.connect(mongoURI, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 10,
        socketTimeoutMS: 45000,
      });
      console.log('[AUTH MIDDLEWARE] MongoDB reconnected successfully.');
    } catch (connErr) {
      console.error('[AUTH MIDDLEWARE] MongoDB reconnection failed:', connErr.message);
    }
  }
};

const auth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token, authorization denied.' });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token || token === 'null' || token === 'undefined') {
      return res.status(401).json({ message: 'No valid token provided, authorization denied.' });
    }
    let decoded = null;

    for (const secret of JWT_SECRETS) {
      try {
        decoded = jwt.verify(token, secret);
        if (decoded) break;
      } catch (err) {
        // try next secret
      }
    }

    if (!decoded) {
      return res.status(401).json({ message: 'Token is invalid or expired, authorization denied.' });
    }

    // Ensure database connection is active before querying User
    await ensureDbConnection();

    const userId = decoded.userId || decoded.id;
    let user = null;

    if (mongoose.connection.readyState === 1) {
      try {
        user = await User.findById(userId).lean();
      } catch (dbErr) {
        console.warn('[AUTH MIDDLEWARE] DB fetch failed, using token payload fallback:', dbErr.message);
      }
    }

    if (!user) {
      // Create minimal decoded user object so authentication succeeds instantly
      user = { _id: userId, id: userId, email: decoded.email };
    } else {
      // Check single-device active token enforcement
      if (!user.currentToken || user.currentToken !== token) {
        return res.status(401).json({
          message: 'Logged out because your account was accessed on another device or logged out from all devices.',
          code: 'SINGLE_DEVICE_CONFLICT',
        });
      }
    }

    // Automatically keep user online status updated when opening/using the app with network
    if (userId && mongoose.connection.readyState === 1) {
      const uIdStr = userId.toString();
      if (global.onlineUsers) {
        global.onlineUsers.set(uIdStr, true);
      }
      User.findByIdAndUpdate(userId, {
        $set: { isLoggedIn: true, isOnline: true, lastSeen: new Date() }
      }).catch(() => {});
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    console.error('Authentication middleware error:', error.message);
    res.status(401).json({ message: 'Token is invalid or expired, authorization denied.', error: error.message });
  }
};

module.exports = auth;
