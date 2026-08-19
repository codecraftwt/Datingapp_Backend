const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });

const User = require('./models/User');
const { sendPushNotification } = require('./services/pushNotificationService');

const runFCMDiagnostics = async () => {
  console.log('--- FCM PUSH NOTIFICATION DIAGNOSTICS ---');
  try {
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/Dating_App';
    console.log('1. Connecting to MongoDB database via Google DNS...');
    
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
    });
    console.log('✅ Connected to MongoDB successfully.');

    console.log('\n2. Inspecting Users in Database for FCM Tokens...');
    const allUsers = await User.find({}).select('name firstName email fcmToken isLoggedIn updatedAt').sort({ updatedAt: -1 });
    
    console.log(`Total Users in Database: ${allUsers.length}`);
    const usersWithToken = allUsers.filter(u => u.fcmToken && u.fcmToken.trim().length > 0);
    console.log(`Users with Active FCM Token: ${usersWithToken.length}`);

    allUsers.forEach((u, i) => {
      const hasToken = u.fcmToken && u.fcmToken.trim().length > 0;
      const tokenPreview = hasToken ? `${u.fcmToken.substring(0, 25)}...` : 'NULL (No Token Registered)';
      console.log(`  [${i + 1}] ${u.firstName || u.name || u.email} | LoggedIn: ${u.isLoggedIn} | Token: ${tokenPreview}`);
    });

    if (usersWithToken.length === 0) {
      console.log('\n❌ CRITICAL FINDING: No users in MongoDB have an active FCM token registered!');
      console.log('💡 REASON: Mobile app on phone did not execute updateFcmToken endpoint or failed token fetch.');
      process.exit(0);
    }

    const targetUser = usersWithToken[0];
    console.log(`\n3. Sending Test Push Notification to User: ${targetUser.firstName || targetUser.name} (${targetUser._id})...`);
    
    const result = await sendPushNotification(targetUser._id, {
      title: '🎉 Live FCM Diagnostic Push',
      body: 'Testing Firebase Cloud Messaging push delivery pipeline!',
      data: { type: 'test', time: Date.now().toString() }
    });

    console.log('\n✅ Push Notification Dispatch Result:', result || 'Dispatched');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ DIAGNOSTIC ERROR:', err.message || err);
    process.exit(1);
  }
};

runFCMDiagnostics();
