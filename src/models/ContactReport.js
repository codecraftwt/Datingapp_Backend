const mongoose = require('mongoose');

const ContactReportSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    subject: {
      type: String,
      trim: true,
      default: 'General Inquiry / App Problem',
    },
    message: {
      type: String,
      required: [true, 'Message description is required.'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'resolved'],
      default: 'pending',
    },
    adminNotes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    collection: 'ContactReports',
    timestamps: true,
  }
);

module.exports = mongoose.model('ContactReport', ContactReportSchema);
