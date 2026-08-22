const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const Match = require('../models/Match');

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/Dating_App';

async function main() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log('Connected to MongoDB successfully.');

    // Find Rina and Sam
    const rina = await User.findOne({ email: /rina/i });
    const sam = await User.findOne({ email: /sam/i });

    if (!rina || !sam) {
      console.error('❌ Rina or Sam user not found!');
      process.exit(1);
    }

    // Set Sam's password to 'Password123' so we can authenticate cleanly
    const hashedPassword = await bcrypt.hash('Password123', 10);
    await User.findByIdAndUpdate(sam._id, {
      password: hashedPassword,
      isLoggedIn: false,
      currentToken: null,
    });
    console.log("Updated Sam's password to 'Password123'.");

    const rinaId = rina._id.toString();
    const samId = sam._id.toString();

    // Ensure Match document exists
    let matchDoc = await Match.findOne({
      $or: [
        { likerId: sam._id, likedId: rina._id },
        { likerId: rina._id, likedId: sam._id }
      ]
    });

    if (!matchDoc) {
      await Match.create({
        likerId: sam._id,
        likedId: rina._id,
        matched: true,
      });
      console.log('Created match record between Sam and Rina.');
    }

    // Login as Sam to get token
    console.log('Logging in as Sam via REST API...');
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: sam.email,
        password: 'Password123'
      })
    });
    const loginData = await loginRes.json();

    if (!loginData.token) {
      console.error('Failed to log in as Sam:', loginData);
      process.exit(1);
    }
    console.log('Logged in as Sam successfully. Token retrieved.');

    const currentTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const messageText = `Hey Rina! 👋 Instant message test from Sam sent at ${currentTimeStr}! Can you see this message live in your chat?`;

    // Send message via REST API (which triggers real-time Socket.IO emission to Rina's device & FCM Push Notification!)
    const sendRes = await fetch('http://localhost:5000/api/chat/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${loginData.token}`
      },
      body: JSON.stringify({
        receiverId: rinaId,
        text: messageText,
        messageType: 'text',
      })
    });

    const sendData = await sendRes.json();
    console.log('✅ Sent message from Sam to Rina via REST API (emitted Socket & Push Notification):', sendData);

    console.log('\nSUCCESS! Sam sent message to Rina.');
    process.exit(0);
  } catch (err) {
    console.error('Error executing sendSamSocketMessage:', err);
    process.exit(1);
  }
}

main();
