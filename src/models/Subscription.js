const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    stripeCustomerId: {
      type: String,
      trim: true,
    },
    stripeSubscriptionId: {
      type: String,
      trim: true,
      index: true,
    },
    productId: {
      type: String,
      trim: true,
    },
    priceId: {
      type: String,
      trim: true,
    },
    planType: {
      type: String,
      enum: ['Gold', 'Premium'],
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'canceled', 'past_due', 'unpaid', 'incomplete', 'trialing'],
      default: 'active',
    },
    currentPeriodStart: {
      type: Date,
    },
    currentPeriodEnd: {
      type: Date,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Subscription', SubscriptionSchema);
