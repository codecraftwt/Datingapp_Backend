const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });
const User = require('./models/User');
const { sendPushNotification } = require('./services/pushNotificationService');

const testPush = async () => {
  try {
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/Dating_App';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoURI);

    // Find the most recently updated user with an FCM token
    const userWithToken = await User.findOne({ fcmToken: { $exists: true, $ne: null } })
      .sort({ updatedAt: -1 });

    if (!userWithToken) {
      console.log('❌ No user found with a registered FCM token in MongoDB.');
      console.log('💡 Tip: Log in to the mobile app first to automatically register an FCM token.');
      process.exit(1);
    }

    console.log(`Found target user: ${userWithToken.firstName || userWithToken.name || userWithToken.email} (${userWithToken._id})`);
    console.log(`FCM Token: ${userWithToken.fcmToken.substring(0, 25)}...`);

    console.log('Sending test push notification...');
    const result = await sendPushNotification(userWithToken._id, {
      title: '🎉 Test Push Notification',
      body: 'Push notifications are working perfectly on your Dating App!',
      data: { type: 'like', test: 'true' },
    });

    console.log('✅ Test push notification sent successfully! Result:', result);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error sending test push notification:', err);
    process.exit(1);
  }
};

testPush();
