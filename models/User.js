const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    password: { type: String, required: true },
    referralCode: { type: String },
    level: { type: Number, default: 1 },
    status: { type: String, enum: ['pending', 'verified', 'active', 'suspended'], default: 'pending' },
    verificationCode: { type: String },

    // 💡 New fields for secure password reset
    resetToken: { type: String },
    resetTokenExpiry: { type: Date },

    balance: {
      available: { type: Number, default: 0 },
      pending: { type: Number, default: 0 },
    },
    tasksCompleted: { type: Number, default: 0 },
    referralBonus: { type: Number, default: 0 },
    invites: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
    profileSet: { type: Boolean, default: false },
    bank: { type: String },
    contact: { type: String },
    transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Withdrawal' }],
    paymentMethods: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PaymentMethod' }],
    referrals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    upgrades: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Upgrade' }],
    lastTaskDate: { type: String },
  },
  { timestamps: true }
);

// Add a partial unique index to avoid duplicate key errors when referralCode is null
userSchema.index(
  { referralCode: 1 },
  { unique: true, partialFilterExpression: { referralCode: { $exists: true, $ne: null } } }
);

module.exports = mongoose.model('User', userSchema);
