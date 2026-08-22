const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (e) {
  // Ignore DNS override errors
}

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Match = require('../models/Match');

const JWT_SECRETS = [
  process.env.JWT_SECRET,
  'super_secret_dating_app_token_key_123!',
  'fallback_secret',
].filter(Boolean);

// Helper: Ensure active MongoDB connection before performing operations
const ensureDbConnection = async () => {
  if (mongoose.connection.readyState === 1) return;

  // If connection is in progress (readyState === 2), wait for it to complete
  if (mongoose.connection.readyState === 2) {
    for (let i = 0; i < 20; i++) {
      if (mongoose.connection.readyState === 1) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  if (mongoose.connection.readyState !== 1) {
    console.log('[AUTH CONTROLLER] MongoDB disconnected (readyState=' + mongoose.connection.readyState + '). Reconnecting...');
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/Dating_App';
    try {
      await mongoose.connect(mongoURI, {
        serverSelectionTimeoutMS: 8000,
        maxPoolSize: 25,
        minPoolSize: 5,
        socketTimeoutMS: 45000,
      });
      console.log('[AUTH CONTROLLER] MongoDB connected successfully.');
    } catch (connErr) {
      console.error('[AUTH CONTROLLER] MongoDB connection failed:', connErr.message);
      throw new Error('Database connection failed. Please check your network connection or MongoDB status.');
    }
  }
};

/**
 * Register a new user
 */
exports.register = async (req, res) => {
  try {
    const {
      name,
      email,
      mobile,
      password,
      confirmPassword,
      gender,
      country,
      state,
      district,
      city,
      latitude,
      longitude,
      tempLatitude,
      tempLongitude,
    } = req.body;

    if (!name || !email || !mobile || !password || !confirmPassword || !gender) {
      return res.status(400).json({ message: 'All basic fields are required.' });
    }

    if (!country || !state || !district || !city) {
      return res.status(400).json({ message: 'Permanent address (Country, State, District, City) is mandatory.' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ message: 'Valid latitude and longitude coordinates are required for permanent address.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Password and Confirm Password do not match.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    if (gender !== 'Male' && gender !== 'Women' && gender !== 'Female' && gender !== 'Non-binary') {
      return res.status(400).json({ message: 'Gender must be Male, Women, Female, or Non-binary.' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email.' });
    }

    const existingMobile = await User.findOne({ mobile });
    if (existingMobile) {
      return res.status(400).json({ message: 'User already exists with this mobile number.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const permanentAddressObj = {
      country: country.trim(),
      state: state.trim(),
      district: district.trim(),
      city: city.trim(),
      location: {
        type: 'Point',
        coordinates: [lng, lat],
      },
    };

    // Optional Temporary Address / Current Location
    let currentLocationObj = undefined;
    if (
      tempLatitude !== null &&
      tempLatitude !== undefined &&
      tempLongitude !== null &&
      tempLongitude !== undefined
    ) {
      const tempLat = parseFloat(tempLatitude);
      const tempLng = parseFloat(tempLongitude);
      if (
        !isNaN(tempLat) &&
        !isNaN(tempLng) &&
        tempLat >= -90 &&
        tempLat <= 90 &&
        tempLng >= -180 &&
        tempLng <= 180 &&
        !(tempLat === 0 && tempLng === 0)
      ) {
        currentLocationObj = {
          location: {
            type: 'Point',
            coordinates: [tempLng, tempLat],
          },
          updatedAt: new Date(),
        };
      }
    }

    const newUser = new User({
      name,
      email,
      mobile,
      password: hashedPassword,
      gender,
      permanentAddress: permanentAddressObj,
      currentLocation: currentLocationObj, // Optional (null/undefined if not fetched)
      location: currentLocationObj?.location || permanentAddressObj.location,
      fcmToken: req.body.fcmToken || null,
      isLoggedIn: false,
      currentToken: null,
      lastSeen: new Date(),
    });

    await newUser.save();

    return res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        mobile: newUser.mobile,
        gender: newUser.gender,
        permanentAddress: newUser.permanentAddress,
        bio: newUser.bio || '',
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ message: 'Server error during registration.' });
  }
};

/**
 * Authenticate user & get token
 */
exports.login = async (req, res) => {
  try {
    const { email, password, fcmToken, forceLogoutAll } = req.body || {};
    console.log('[AUTH CONTROLLER] Login attempt for email:', email);

    // Ensure active MongoDB connection before querying
    await ensureDbConnection();

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    // Escape special regex characters in email to prevent invalid regular expression errors
    const safeRegexEmail = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const user = await User.findOne({
      $or: [
        { email: cleanEmail },
        { email: { $regex: new RegExp(`^${safeRegexEmail}$`, 'i') } }
      ]
    });

    if (!user || !user.password) {
      return res.status(400).json({ message: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password.' });
    }

    // Single-device login check: If active valid token exists in DB and forceLogoutAll is false, block login
    if (user.currentToken && forceLogoutAll !== true) {
      let isTokenActive = false;
      for (const secret of JWT_SECRETS) {
        try {
          jwt.verify(user.currentToken, secret);
          isTokenActive = true;
          break;
        } catch (err) {
          // Token expired or invalid
        }
      }

      if (isTokenActive) {
        console.log(`[AUTH CONTROLLER] Blocking login for ${user.email} (Active token exists in database).`);
        return res.status(409).json({
          status: 'DEVICE_LIMIT_REACHED',
          message: 'Device limit reached. User is already logged in, please Logout from all devices.',
        });
      } else {
        // Token was expired or invalid - clear stale token
        console.log(`[AUTH CONTROLLER] Clearing expired/invalid token for ${user.email}.`);
        await User.findByIdAndUpdate(user._id, {
          $set: { currentToken: null, isLoggedIn: false }
        });
      }
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || 'super_secret_dating_app_token_key_123!',
      { expiresIn: '7d' }
    );

    // Safely update user status, currentToken, and FCM token
    try {
      console.log(`[BACKEND AUTH] Login payload for ${user.email} - fcmToken:`, fcmToken ? (fcmToken.substring(0, 25) + '...') : 'NONE / UNDEFINED');
      const updateFields = { isLoggedIn: true, lastSeen: new Date(), currentToken: token };
      if (fcmToken) {
        updateFields.fcmToken = fcmToken;
      }
      const updatedUser = await User.findByIdAndUpdate(user._id, { $set: updateFields }, { new: true });
      console.log(`[BACKEND AUTH] MongoDB updated fcmToken for user ${user._id}:`, updatedUser?.fcmToken ? 'SAVED SUCCESS' : 'NULL');
    } catch (updateErr) {
      console.warn('[AUTH CONTROLLER] Non-fatal user status update error during login:', updateErr.message);
    }

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        _id: user._id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        gender: user.gender,
        firstName: user.firstName,
        bdayDay: user.bdayDay,
        bdayMonth: user.bdayMonth,
        bdayYear: user.bdayYear,
        age: user.age,
        orientation: user.orientation,
        drinkHabit: user.drinkHabit,
        smokeHabit: user.smokeHabit,
        exercise: user.exercise,
        pets: user.pets,
        educationLevel: user.educationLevel,
        zodiac: user.zodiac,
        interests: user.interests || [],
        languages: user.languages || [],
        interestedIn: user.interestedIn,
        lookingFor: user.lookingFor,
        ageRangeMin: user.ageRangeMin,
        ageRangeMax: user.ageRangeMax,
        distanceRange: user.distanceRange,
        profileImage: user.profileImage,
        profileImages: user.profileImages || [],
        bio: user.bio || '',
        fcmToken: user.fcmToken || null,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error during login.', error: error.message });
  }
};

/**
 * Log user out (sets isLoggedIn to false)
 */
exports.logout = async (req, res) => {
  try {
    const userId = req.user._id;
    const lastSeenDate = new Date();

    const user = await User.findById(userId);
    if (user) {
      user.isLoggedIn = false;
      user.lastSeen = lastSeenDate;
      user.fcmToken = null;
      await user.save();
    }

    if (global.onlineUsers) {
      global.onlineUsers.delete(userId.toString());
    }

    const io = req.app ? req.app.get('io') : null;
    if (io) {
      io.emit('user_status', {
        userId: userId.toString(),
        status: 'offline',
        lastSeen: lastSeenDate.toISOString(),
      });
    }

    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ message: 'Server error during logout.' });
  }
};

/**
 * Generate a 6-digit password reset code
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: 'User with this email does not exist.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    user.resetPasswordToken = code;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
    await user.save();

    return res.status(200).json({
      message: 'Password reset code generated successfully.',
      code: code
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ message: 'Server error during forgot password.' });
  }
};

/**
 * Verify 6-digit code and reset password
 */
exports.resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: 'Email, code, and new password are required.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      resetPasswordToken: code,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    return res.status(200).json({ message: 'Password reset successfully.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ message: 'Server error during password reset.' });
  }
};

/**
 * Change user password (authenticated)
 */
exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const currentUserId = req.user._id;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Both old password and new password are required.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters long.' });
    }

    const user = await User.findById(currentUserId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect current password.' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    return res.status(200).json({ message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ message: 'Server error while changing password.' });
  }
};

/**
 * Delete account (clean matches & messages)
 */
exports.deleteAccount = async (req, res) => {
  try {
    const currentUserId = req.user._id;

    await Match.deleteMany({
      $or: [
        { likerId: currentUserId },
        { likedId: currentUserId }
      ]
    });

    await Message.deleteMany({
      $or: [
        { senderId: currentUserId },
        { receiverId: currentUserId }
      ]
    });

    await User.findByIdAndDelete(currentUserId);

    return res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({ message: 'Server error during account deletion.' });
  }
};

/**
 * Logout user from all devices (clears currentToken and isLoggedIn)
 */
exports.logoutAllDevices = async (req, res) => {
  try {
    await ensureDbConnection();
    const { email, password } = req.body || {};
    let userId = req.user?._id || req.user?.id;

    // 1. Try extracting userId from Authorization Bearer token header if available
    if (!userId) {
      const authHeader = req.header('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        if (token && token !== 'null' && token !== 'undefined') {
          for (const secret of JWT_SECRETS) {
            try {
              const decoded = jwt.verify(token, secret);
              if (decoded && (decoded.userId || decoded.id)) {
                userId = decoded.userId || decoded.id;
                break;
              }
            } catch (e) {}
          }
        }
      }
    }

    // 2. Fallback to credentials check (email & password) if token not provided/valid
    if (!userId && email && password) {
      const cleanEmail = email.trim().toLowerCase();
      const safeRegexEmail = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const user = await User.findOne({
        $or: [
          { email: cleanEmail },
          { email: { $regex: new RegExp(`^${safeRegexEmail}$`, 'i') } }
        ]
      });

      if (user && user.password) {
        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
          userId = user._id;
        }
      }
    }

    if (!userId) {
      return res.status(400).json({ message: 'Invalid credentials or user identity. Please provide a valid session token or login credentials.' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          currentToken: null,
          isLoggedIn: false,
          fcmToken: null,
        },
      },
      { new: true }
    );

    console.log(`[AUTH CONTROLLER] Successfully logged out user ${userId} (${updatedUser?.email || 'user'}) from all devices.`);

    return res.status(200).json({
      success: true,
      message: 'Successfully logged out from all devices.',
      user: updatedUser ? {
        id: updatedUser._id,
        email: updatedUser.email,
        isLoggedIn: false,
        currentToken: null,
      } : null,
    });
  } catch (error) {
    console.error('Logout all devices error:', error);
    return res.status(500).json({ message: 'Server error during logout from all devices.', error: error.message });
  }
};

/**
 * Logout user from current session
 */
exports.logout = async (req, res) => {
  try {
    await ensureDbConnection();
    let userId = req.user?._id || req.user?.id;

    if (!userId) {
      const authHeader = req.header('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        if (token && token !== 'null' && token !== 'undefined') {
          for (const secret of JWT_SECRETS) {
            try {
              const decoded = jwt.verify(token, secret);
              if (decoded && (decoded.userId || decoded.id)) {
                userId = decoded.userId || decoded.id;
                break;
              }
            } catch (e) {}
          }
        }
      }
    }

    if (userId) {
      await User.findByIdAndUpdate(userId, {
        $set: {
          currentToken: null,
          isLoggedIn: false,
          fcmToken: null,
        },
      });
    }

    return res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ message: 'Server error during logout.', error: error.message });
  }
};
