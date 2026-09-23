const mongoose = require('mongoose');

const PlanFeatureSchema = new mongoose.Schema(
  {
    featureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Feature',
    },
    featureKey: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    isAllowed: {
      type: Boolean,
      default: true,
    },
    limitValue: {
      type: Number,
      default: -1, // -1 means unlimited, 0 means not allowed, > 0 means specific count limit
    },
  },
  { _id: false }
);

const PlanSchema = new mongoose.Schema(
  {
    planKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    price: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'quarterly', 'yearly', 'lifetime', 'free'],
      default: 'monthly',
    },
    stripeProductId: {
      type: String,
      trim: true,
      default: '',
    },
    stripePriceId: {
      type: String,
      trim: true,
      default: '',
    },
    features: [PlanFeatureSchema],
    highlightBadge: {
      type: String,
      trim: true,
      default: '',
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Plan', PlanSchema);
