const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Report = require('../models/Report');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_dating_app_token_key_123!';
const STATIC_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@datingapp.com').toLowerCase();
const STATIC_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123456';

/**
 * POST /api/admin/register
 * Admin Registration Endpoint
 */
exports.registerAdmin = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required for admin registration.',
      });
    }

    const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'An admin with this email already exists.',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = new Admin({
      name: name || 'Admin User',
      email: email.toLowerCase(),
      password: hashedPassword,
      role: role || 'superadmin',
    });

    await newAdmin.save();

    const payload = {
      id: newAdmin._id,
      email: newAdmin.email,
      role: newAdmin.role,
      isAdmin: true,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      success: true,
      message: 'Admin account registered successfully.',
      token,
      admin: {
        id: newAdmin._id,
        name: newAdmin.name,
        email: newAdmin.email,
        role: newAdmin.role,
        createdAt: newAdmin.createdAt,
      },
    });
  } catch (error) {
    console.error('registerAdmin error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during admin registration.',
      error: error.message,
    });
  }
};

/**
 * POST /api/admin/login
 * Admin Login Endpoint (Supports Static Credentials & Database Admins)
 */
exports.loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password.',
      });
    }

    const inputEmail = email.trim().toLowerCase();
    const inputPassword = password.trim();

    // 1. Check if Static Admin credentials match
    if (inputEmail === STATIC_ADMIN_EMAIL && inputPassword === STATIC_ADMIN_PASSWORD) {
      let admin = await Admin.findOne({ email: STATIC_ADMIN_EMAIL });
      if (!admin) {
        const hashedPassword = await bcrypt.hash(STATIC_ADMIN_PASSWORD, 10);
        admin = new Admin({
          name: 'Super Admin',
          email: STATIC_ADMIN_EMAIL,
          password: hashedPassword,
          role: 'superadmin',
        });
      }
      admin.lastLogin = new Date();
      await admin.save();

      const payload = {
        id: admin._id,
        email: admin.email,
        role: admin.role,
        isAdmin: true,
      };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

      return res.status(200).json({
        success: true,
        message: 'Admin login successful 🎉',
        token,
        admin: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          lastLogin: admin.lastLogin,
        },
      });
    }

    // 2. Fallback to Database Admin check
    const admin = await Admin.findOne({ email: inputEmail });
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials.',
      });
    }

    const isMatch = await bcrypt.compare(inputPassword, admin.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials.',
      });
    }

    admin.lastLogin = new Date();
    await admin.save();

    const payload = {
      id: admin._id,
      email: admin.email,
      role: admin.role,
      isAdmin: true,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    return res.status(200).json({
      success: true,
      message: 'Admin login successful 🎉',
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        lastLogin: admin.lastLogin,
      },
    });
  } catch (error) {
    console.error('loginAdmin error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during admin login.',
      error: error.message,
    });
  }
};

/**
 * GET /api/admin/users
 * Fetch All Registered Users for Admin Panel
 */
exports.getAllRegisteredUsers = async (req, res) => {
  try {
    const {
      search,
      gender,
      isLoggedIn,
      page = 1,
      limit = 50,
      all,
      sortBy = 'createdAt',
      order = 'desc',
    } = req.query;

    const filter = {};

    // 1. Search Query Filter (name, firstName, email, mobile)
    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { name: searchRegex },
        { firstName: searchRegex },
        { email: searchRegex },
        { mobile: searchRegex },
      ];
    }

    // 2. Gender Filter
    if (gender) {
      filter.gender = new RegExp(`^${gender.trim()}$`, 'i');
    }

    // 3. Online Status Filter
    if (isLoggedIn !== undefined) {
      filter.isLoggedIn = isLoggedIn === 'true';
    }

    // Sort order setup
/**
 * Helper to check if a user is currently online (ONLY if user has live socket connection inside app)
 */
const checkIsOnline = (user) => {
  if (!user) return false;
  const uIdStr = (user._id || user.id || user).toString();
  const inMap = !!(global.onlineUsers && global.onlineUsers.has(uIdStr));
  let inRoom = false;
  if (global.io && global.io.sockets && global.io.sockets.adapter && global.io.sockets.adapter.rooms.has(uIdStr)) {
    const rm = global.io.sockets.adapter.rooms.get(uIdStr);
    if (rm && rm.size > 0) inRoom = true;
  }
  return inMap || inRoom;
};

    const sortOrder = order === 'asc' ? 1 : -1;
    const sortObj = { [sortBy]: sortOrder };

    const totalUsersCount = await User.countDocuments({});
    const menCount = await User.countDocuments({ gender: /^men$/i });
    const womenCount = await User.countDocuments({ gender: /^women$/i });

    let query = User.find(filter)
      .select('name firstName email mobile gender age orientation interestedIn lookingFor profileImage profileImages fcmToken isLoggedIn isOnline lastSeen createdAt updatedAt warnings')
      .sort(sortObj);

    let pageNum = parseInt(page, 10) || 1;
    let limitNum = parseInt(limit, 10) || 50;

    if (all !== 'true') {
      query = query.skip((pageNum - 1) * limitNum).limit(limitNum);
    }

    const rawUsers = await query.lean();
    const filteredCount = await User.countDocuments(filter);

    let activeOnlineCalcCount = 0;
    const users = rawUsers.map((u) => {
      const isOnline = checkIsOnline(u);
      if (isOnline) activeOnlineCalcCount++;
      return {
        ...u,
        isOnline,
        isLoggedIn: u.isLoggedIn === true,
      };
    });

    const onlineUsersCount = Math.max(
      global.onlineUsers ? global.onlineUsers.size : 0,
      activeOnlineCalcCount
    );

    return res.status(200).json({
      success: true,
      message: 'Fetched all registered users successfully.',
      analytics: {
        totalUsers: totalUsersCount,
        onlineUsers: onlineUsersCount,
        genderBreakdown: {
          men: menCount,
          women: womenCount,
        },
      },
      pagination: {
        totalUsers: filteredCount,
        totalPages: all === 'true' ? 1 : Math.ceil(filteredCount / limitNum),
        currentPage: pageNum,
        limit: all === 'true' ? filteredCount : limitNum,
      },
      users,
    });
  } catch (error) {
    console.error('getAllRegisteredUsers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching registered users.',
      error: error.message,
    });
  }
};

/**
 * GET /api/admin/reports
 * Fetch All User Complaint Reports for Admin Panel
 */
exports.getAllReports = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, all } = req.query;

    const filter = {};
    if (status) {
      filter.status = status.trim().toLowerCase();
    }

    const totalReportsCount = await Report.countDocuments({});
    const pendingReportsCount = await Report.countDocuments({ status: 'pending' });
    const resolvedReportsCount = await Report.countDocuments({ status: 'resolved' });

    let query = Report.find(filter)
      .populate('reporterId', 'name firstName email profileImage mobile')
      .populate('reportedId', 'name firstName email profileImage mobile warnings')
      .sort({ createdAt: -1 });

    let pageNum = parseInt(page, 10) || 1;
    let limitNum = parseInt(limit, 10) || 20;

    if (all !== 'true') {
      query = query.skip((pageNum - 1) * limitNum).limit(limitNum);
    }

    const reports = await query.lean();

    // Include warned users from User collection if no separate Report document exists
    try {
      const warnedUsers = await User.find({ 'warnings.0': { $exists: true } }).lean();
      for (const u of warnedUsers) {
        for (const w of (u.warnings || [])) {
          const uIdStr = u._id.toString();
          const existingRep = reports.find((r) => {
            const rId = (r.reportedId?._id || r.reportedId)?.toString();
            return rId === uIdStr;
          });

          if (!existingRep) {
            reports.push({
              _id: 'rep_' + (w._id || uIdStr),
              reporterId: { name: 'Admin Moderation Team', email: 'admin@datingapp.com' },
              reportedId: u,
              reason: `[${w.category || 'Warning'}] ${w.message || 'Official community warning issued by Admin moderation team.'}`,
              details: w.isAcknowledged ? 'Report Viewed & Acknowledged' : `Severity: ${(w.severity || 'high').toUpperCase()}`,
              status: w.isAcknowledged ? 'resolved' : 'reviewed',
              isAcknowledged: w.isAcknowledged === true,
              acknowledgedAt: w.acknowledgedAt || null,
              createdAt: w.issuedAt || u.updatedAt || new Date(),
            });
          } else {
            // Synchronize acknowledgement status onto existing report if user acknowledged
            if (w.isAcknowledged) {
              existingRep.isAcknowledged = true;
              existingRep.acknowledgedAt = w.acknowledgedAt || existingRep.acknowledgedAt || new Date();
              existingRep.status = 'resolved';
              existingRep.details = 'Report Viewed & Acknowledged';
            }
          }
        }
      }
    } catch (wErr) {
      console.error('Error combining warned users into getAllReports:', wErr);
    }

    const filteredCount = reports.length;

    return res.status(200).json({
      success: true,
      message: 'Fetched all user complaint reports successfully.',
      analytics: {
        totalReports: totalReportsCount,
        pendingReports: pendingReportsCount,
        resolvedReports: resolvedReportsCount,
      },
      pagination: {
        totalReports: filteredCount,
        totalPages: all === 'true' ? 1 : Math.ceil(filteredCount / limitNum),
        currentPage: pageNum,
        limit: all === 'true' ? filteredCount : limitNum,
      },
      reports,
    });
  } catch (error) {
    console.error('getAllReports error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching user reports.',
      error: error.message,
    });
  }
};

/**
 * PUT /api/admin/reports/:reportId
 * Admin Update Report Status (e.g. resolve, dismiss, review)
 */
exports.updateReportStatus = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, details } = req.body;

    if (!status || !['pending', 'reviewed', 'resolved', 'dismissed'].includes(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Allowed values: pending, reviewed, resolved, dismissed.',
      });
    }

    const updatedReport = await Report.findByIdAndUpdate(
      reportId,
      {
        status: status.toLowerCase(),
        ...(details ? { details } : {}),
      },
      { new: true }
    )
      .populate('reporterId', 'name firstName email')
      .populate('reportedId', 'name firstName email');

    if (!updatedReport) {
      return res.status(404).json({
        success: false,
        message: 'Report not found.',
      });
    }

    // Send Push Notification & Save Notification Record for the Reporting User
    if (updatedReport.reporterId && (status.toLowerCase() === 'resolved' || status.toLowerCase() === 'dismissed' || status.toLowerCase() === 'reviewed')) {
      try {
        const { sendPushNotification } = require('../services/pushNotificationService');
        const reportedName = updatedReport.reportedId?.firstName || updatedReport.reportedId?.name || 'the reported user';
        
        const notifTitle = status.toLowerCase() === 'resolved' 
          ? '🛡️ Action Taken on Your Report' 
          : '🛡️ Update on Your Report';
        
        const notifBody = status.toLowerCase() === 'resolved'
          ? `Thank you for keeping our community safe! We reviewed your report regarding ${reportedName} and have taken appropriate action.`
          : `Thank you for your report regarding ${reportedName}. Our moderation team has reviewed the report details.`;

        sendPushNotification(updatedReport.reporterId._id, {
          title: notifTitle,
          body: notifBody,
          data: {
            type: 'report_update',
            reportId: updatedReport._id.toString(),
            status: updatedReport.status,
          },
        }).catch((pErr) => console.error('Admin Report update push error:', pErr));
      } catch (nErr) {
        console.error('Error dispatching report notification:', nErr);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Report status updated to '${updatedReport.status}' successfully and notification sent to reporter.`,
      report: updatedReport,
    });
  } catch (error) {
    console.error('updateReportStatus error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while updating report status.',
      error: error.message,
    });
  }
};

/**
 * POST /api/admin/warn-user
 * Issue Official Warning to a Reported User (Without reporter field requirement)
 */
exports.warnUser = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const User = require('../models/User');
    const { reportedId, category, message, severity } = req.body;

    if (!reportedId || !category || !message) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: reportedId, category, and message are required.',
      });
    }

    const user = await User.findById(reportedId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Reported user not found in database.',
      });
    }

    const newWarning = {
      _id: new mongoose.Types.ObjectId(),
      category: category.trim(),
      message: message.trim(),
      severity: (severity || 'high').toLowerCase(),
      issuedBy: 'Admin Moderation Team',
      issuedAt: new Date(),
      isAcknowledged: false,
    };

    user.warnings = user.warnings || [];
    user.warnings.unshift(newWarning);
    await user.save();

    // Create Report entry so warning appears in Admin Panel Reports tab
    try {
      await Report.create({
        reporterId: req.user?._id || user._id,
        reportedId: user._id,
        reason: `[${category.trim()}] ${message.trim()}`,
        details: `Severity: ${(severity || 'high').toUpperCase()} | Issued by Admin Moderation Team`,
        status: 'reviewed',
      });
    } catch (rErr) {
      console.error('Error creating report record for warning:', rErr);
    }

    // Emit live Socket.IO event if reported user is currently online
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(user._id.toString()).emit('user_warning', newWarning);
      }
    } catch (sErr) {
      console.error('Socket emission error for warning:', sErr);
    }

    return res.status(200).json({
      success: true,
      message: `Official warning issued successfully to ${user.name || user.firstName || 'user'}.`,
      warning: newWarning,
    });
  } catch (error) {
    console.error('warnUser error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while issuing warning to user.',
      error: error.message,
    });
  }
};
