const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  referralCode: { type: String, unique: true },
  level: { type: Number, default: 1 },
  status: { type: String, enum: ['pending', 'verified', 'active', 'suspended'], default: 'pending' },
  verificationCode: { type: String },
  balance: {
    available: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
  },
  tasksCompleted: { type: Number, default: 0 },
  referralBonus: { type: Number, default: 0 },
  invites: { type: Number, default: 0 }, // Tracks number of referrals
  isAdmin: { type: Boolean, default: false },
  profileSet: { type: Boolean, default: false },
  bank: { type: String },
  contact: { type: String }, // For admin contact info
  transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Withdrawal' }],
  paymentMethods: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PaymentMethod' }],
  referrals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Referral' }],
  upgrades: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Upgrade' }],
  lastTaskDate: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);