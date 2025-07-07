const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  type: { type: String, enum: ['verification', 'reset-password', 'notification'], required: true },
  recipient: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('EmailLog', emailLogSchema);