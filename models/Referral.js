const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  referredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // renamed
  bonus: { type: Number, default: 0 }, // added
  earnings: { type: Number, default: 0 },
  joined: { type: Date, default: Date.now },
  verified: { type: Boolean, default: false },
  suspicious: { type: Boolean, default: false } // added based on your code
}, { timestamps: true });

module.exports = mongoose.model('Referral', referralSchema);