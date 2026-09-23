const mongoose = require('mongoose');

const FeatureSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
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
    valueType: {
      type: String,
      enum: ['boolean', 'numeric', 'unlimited'],
      default: 'boolean',
    },
    category: {
      type: String,
      enum: ['Swiping', 'Discovery', 'Social', 'Search', 'General'],
      default: 'General',
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

module.exports = mongoose.model('Feature', FeatureSchema);
