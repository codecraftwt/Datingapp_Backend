const mongoose = require('mongoose');

const ChatMediaSchema = new mongoose.Schema(
  {
    fileName: {
      type: String,
      required: true,
      index: true,
    },
    originalName: {
      type: String,
    },
    mimeType: {
      type: String,
      default: 'audio/mp4',
    },
    size: {
      type: Number,
      default: 0,
    },
    data: {
      type: Buffer,
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Prevent returning the heavy binary buffer by default in json queries
ChatMediaSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.data;
    return ret;
  },
});

module.exports = mongoose.model('ChatMedia', ChatMediaSchema);
