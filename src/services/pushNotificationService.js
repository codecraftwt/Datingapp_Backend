const admin = require('firebase-admin');
const { getMessaging } = require('firebase-admin/messaging');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');

let isFirebaseInitialized = false;

try {
  let serviceAccount = null;

  // 1. Check if provided via environment variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      let rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      if ((rawEnv.startsWith("'") && rawEnv.endsWith("'")) || (rawEnv.startsWith('"') && rawEnv.endsWith('"'))) {
        rawEnv = rawEnv.slice(1, -1);
      }
      serviceAccount = typeof rawEnv === 'object' ? rawEnv : JSON.parse(rawEnv);
    } catch (e) {
      console.error('[FCM Push] Error parsing FIREBASE_SERVICE_ACCOUNT env var:', e.message);
    }
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    try {
      const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
      serviceAccount = JSON.parse(decoded);
    } catch (e) {
      console.error('[FCM Push] Error parsing FIREBASE_SERVICE_ACCOUNT_BASE64 env var:', e.message);
    }
  }

  // 2. Check candidate service account key files on disk
  if (!serviceAccount) {
    const searchDirs = [process.cwd(), path.join(__dirname, '..'), path.join(__dirname, '../..')];
    for (const dir of searchDirs) {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir);
          const jsonMatch = files.find((f) => f.toLowerCase().includes('firebase') && f.endsWith('.json'));
          if (jsonMatch) {
            const fullPath = path.join(dir, jsonMatch);
            serviceAccount = require(fullPath);
            console.log(`[FCM Push] Found Firebase JSON file: ${jsonMatch}`);
            break;
          }
        } catch (e) {}
      }
    }
  }

  if (serviceAccount) {
    if (serviceAccount.private_key && typeof serviceAccount.private_key === 'string') {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    const credential = (admin.credential && admin.credential.cert) ? admin.credential.cert(serviceAccount) : admin.cert(serviceAccount);
    if (!admin.apps || admin.apps.length === 0) {
      admin.initializeApp({ credential });
    }
    isFirebaseInitialized = true;
    console.log('[FCM Push] Firebase Admin SDK successfully initialized.');
  } else {
    console.warn('[FCM Push] Warning: Firebase service account not found (check JSON file or FIREBASE_SERVICE_ACCOUNT env var).');
  }
} catch (err) {
  console.error('[FCM Push] Failed to initialize Firebase Admin SDK:', err.message);
}

const Notification = require('../models/Notification');

/**
 * Send FCM push notification & save to MongoDB database
 * @param {string|ObjectId} targetUserId - Receiver user ID
 * @param {Object} payload - { title, body, data }
 */
const sendPushNotification = async (targetUserId, { title, body, data = {} }) => {
  try {
    if (!targetUserId) return;

    // 1. Save Notification record to MongoDB (works even if user is logged out)
    const senderId = data.senderId || data.userId;
    const validTypes = ['like', 'match', 'chat', 'superlike'];
    const notificationType = validTypes.includes(data.type) ? data.type : 'chat';

    let notificationId = null;
    if (senderId) {
      try {
        const createdDoc = await Notification.create({
          recipient: targetUserId,
          sender: senderId,
          type: notificationType,
          title: title || 'New Notification',
          body: body || '',
          data: {
            ...data,
            senderId: senderId.toString(),
          },
          isRead: false,
        });
        notificationId = createdDoc._id.toString();
        await Notification.findByIdAndUpdate(createdDoc._id, {
          $set: { 'data.notificationId': notificationId }
        });
        console.log(`[Notification Engine] Persisted ${notificationType} notification (ID: ${notificationId}) to DB for recipient ${targetUserId}`);
      } catch (dbErr) {
        console.error('[Notification Engine] Error saving notification to DB:', dbErr.message);
      }
    }

    // 2. Dispatch FCM Push Notification if Firebase is initialized & FCM token exists
    if (!isFirebaseInitialized) {
      console.log('[FCM Push] Skipped FCM Push - Firebase Admin not initialized.');
      return;
    }

    const user = await User.findById(targetUserId).select('fcmToken name');
    if (!user || !user.fcmToken) {
      console.log(`[FCM Push] User ${targetUserId} has no active FCM token (Offline/Logged Out). Notification is saved in DB for login sync.`);
      return;
    }

    // Ensure all entries in data payload are non-null string key-value pairs for FCM
    const payloadData = {};
    if (data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined && v !== null) {
          payloadData[k] = v.toString();
        }
      }
    }
    payloadData.notificationId = (notificationId || Date.now()).toString();
    payloadData.click_action = 'FLUTTER_NOTIFICATION_CLICK';

    const message = {
      token: user.fcmToken,
      notification: {
        title: title || 'New Notification',
        body: body || '',
      },
      data: payloadData,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'default_notification_channel_v2',
          priority: 'high',
          defaultVibrateTimings: true,
          tag: notificationId || undefined,
        },
      },
    };

    const response = await getMessaging().send(message);
    console.log(`[FCM Push] Notification sent successfully to user ${user.name || targetUserId} (Msg ID: ${response})`);
    return response;
  } catch (error) {
    console.error(`[FCM Push] Error sending notification to user ${targetUserId}:`, error.message);
    // If token is invalid or expired, clear it
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      await User.findByIdAndUpdate(targetUserId, { $unset: { fcmToken: 1 } });
    }
  }
};

module.exports = {
  sendPushNotification,
};
