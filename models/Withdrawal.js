const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  paymentMethod: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentMethod' },
  status: { type: String, enum: ['pending', 'approved', 'declined', 'paid'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Withdrawal', withdrawalSchema);