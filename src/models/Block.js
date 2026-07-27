const mongoose = require('mongoose');

const BlockSchema = new mongoose.Schema(
  {
    blockerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    blockedId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      default: '',
    },
  },
  {
    collection: 'Blocks',
    timestamps: true,
  }
);

// Prevent duplicate block entries between the same blocker and blocked user
BlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

module.exports = mongoose.model('Block', BlockSchema);
