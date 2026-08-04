const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });
const Notification = require('./models/Notification');
const User = require('./models/User');
const Message = require('./models/Message');

const checkDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/Dating_App';
    await mongoose.connect(mongoURI);
    console.log('Connected to MongoDB.');

    const users = await User.find({}).select('_id email firstName name fcmToken');
    console.log('\n--- USERS ---');
    users.forEach(u => {
      console.log(`User: ${u.firstName || u.name} | Email: ${u.email} | ID: ${u._id} | FCM: ${u.fcmToken ? u.fcmToken.substring(0, 15) + '...' : 'NULL'}`);
    });

    const notifications = await Notification.find({})
      .populate('recipient', 'email firstName name')
      .populate('sender', 'email firstName name')
      .sort({ createdAt: -1 });

    console.log(`\n--- NOTIFICATIONS IN DB (Total: ${notifications.length}) ---`);
    notifications.forEach(n => {
      console.log(`[${n.createdAt.toISOString()}] To: ${n.recipient?.firstName || n.recipient?.email} | From: ${n.sender?.firstName || n.sender?.email} | Type: ${n.type} | Read: ${n.isRead} | Title: "${n.title}" | Body: "${n.body}"`);
    });

    const messages = await Message.find({}).sort({ createdAt: -1 }).limit(5);
    console.log(`\n--- LATEST MESSAGES (Total: ${messages.length}) ---`);
    messages.forEach(m => {
      console.log(`[${m.createdAt.toISOString()}] Sender: ${m.senderId} | Receiver: ${m.receiverId} | Text: "${m.text}"`);
    });

    process.exit(0);
  } catch (err) {
    console.error('Error checking DB:', err);
    process.exit(1);
  }
};

checkDB();
