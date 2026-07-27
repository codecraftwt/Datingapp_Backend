const mongoose = require('mongoose');

const MatchSchema = new mongoose.Schema(
  {
    likerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    likedId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    collection: 'Matches', // Targets the "Matches" collection created by the user
    timestamps: true,
  }
);

module.exports = mongoose.model('Match', MatchSchema);
