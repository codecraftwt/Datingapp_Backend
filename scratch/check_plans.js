const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (e) {}

const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://codecraftwt_db_user:GBkH8aUltJHmWfC9@cluster0.sgej2ij.mongodb.net/Dating_App?retryWrites=true&w=majority&appName=Cluster0';

async function checkPlans() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');
    const Plan = mongoose.model('Plan', new mongoose.Schema({}, { strict: false }));
    const plans = await Plan.find({});
    console.log(`Found ${plans.length} plans in DB:`);
    plans.forEach((p, idx) => {
      console.log(`\n--- Plan #${idx + 1} ---`);
      console.log('ID:', p._id);
      console.log('Name:', p.name);
      console.log('PlanKey:', p.planKey);
      console.log('Price:', p.price);
      console.log('Badge:', p.highlightBadge);
      console.log('IsActive:', p.isActive);
      console.log('Features:', p.features);
    });
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err);
  }
}

checkPlans();
