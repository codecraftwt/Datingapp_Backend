const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      trim: true,
    },
    messageType: {
      type: String,
      enum: ['text', 'sticker', 'image', 'document', 'voice', 'call'],
      default: 'text',
    },
    mediaUrl: {
      type: String,
    },
    fileName: {
      type: String,
    },
    fileSize: {
      type: Number,
    },
    stickerId: {
      type: String,
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'seen'],
      default: 'sent',
    },
    tempId: {
      type: String,
      index: true,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    deletedBySender: {
      type: Boolean,
      default: false,
    },
    deletedByReceiver: {
      type: Boolean,
      default: false,
    },
    reactions: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        emoji: String,
        createdAt: { type: Date, default: Date.now }
      }
    ],
    replyTo: {
      messageId: String,
      senderId: String,
      text: String,
      senderName: String,
      messageType: String,
      mediaUrl: String,
      fileName: String,
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    isStarred: {
      type: Boolean,
      default: false,
    },
    isDeletedForEveryone: {
      type: Boolean,
      default: false,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
  },
  {
    collection: 'Messages', // Explicitly target the "Messages" collection
    timestamps: true,
  }
);

module.exports = mongoose.model('Message', MessageSchema);
