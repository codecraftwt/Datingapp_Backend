const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const Match = require('../models/Match');
const Message = require('../models/Message');

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

    if (!rina) {
      console.error('❌ User rina not found!');
      process.exit(1);
    }
    if (!sam) {
      console.error('❌ User sam not found!');
      process.exit(1);
    }

    console.log(`Found Rina (ID: ${rina._id}, Name: ${rina.name || rina.firstName}, Email: ${rina.email})`);
    console.log(`Found Sam (ID: ${sam._id}, Name: ${sam.name || sam.firstName}, Email: ${sam.email})`);

    const rinaId = rina._id.toString();
    const samId = sam._id.toString();

    // Ensure Match document exists between Sam and Rina so they can chat
    let matchDoc = await Match.findOne({
      $or: [
        { likerId: sam._id, likedId: rina._id },
        { likerId: rina._id, likedId: sam._id }
      ]
    });

    if (!matchDoc) {
      matchDoc = await Match.create({
        likerId: sam._id,
        likedId: rina._id,
        matched: true,
      });
      console.log('Created match record between Sam and Rina.');
    } else {
      console.log('Match record already exists between Sam and Rina.');
    }

    const currentTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const testMessageText = `Hey Rina! 👋 Testing instant chat messaging at ${currentTimeStr}! Can you see this message live?`;

    // Try sending message via Sam's REST API endpoint using native fetch
    try {
      console.log('Logging in as Sam via fetch...');
      const loginRes = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: sam.email,
          password: 'Password123'
        })
      });
      const loginData = await loginRes.json();

      if (loginData.token) {
        console.log('Logged in as Sam successfully. Token retrieved.');

        const sendRes = await fetch('http://localhost:5000/api/chat/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${loginData.token}`
          },
          body: JSON.stringify({
            receiverId: rinaId,
            text: testMessageText,
            messageType: 'text',
          })
        });
        const sendData = await sendRes.json();
        console.log('✅ Sent message from Sam to Rina via REST API:', sendData);
      } else {
        throw new Error('Login failed: ' + JSON.stringify(loginData));
      }
    } catch (apiErr) {
      console.warn('REST API message send error, falling back to direct DB creation:', apiErr.message);

      const newMsg = await Message.create({
        senderId: sam._id,
        receiverId: rina._id,
        text: testMessageText,
        messageType: 'text',
        status: 'delivered',
      });
      console.log('✅ Created message in DB directly:', newMsg._id);
    }

    console.log('\nSUCCESS! Test message from Sam has been dispatched to Rina.');
    process.exit(0);
  } catch (err) {
    console.error('Error executing sendTestMessage script:', err);
    process.exit(1);
  }
}

main();
