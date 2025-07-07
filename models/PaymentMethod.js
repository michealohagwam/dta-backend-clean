const mongoose = require('mongoose');

const paymentMethodSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['Bank Account', 'PayPal'], required: true },
  details: {
    bank: String,
    accountNumber: String,
    accountName: String,
    email: String // For PayPal
  }
}, { timestamps: true });

module.exports = mongoose.model('PaymentMethod', paymentMethodSchema);
