const mongoose = require('mongoose');

const upgradeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  level: { type: Number, required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  date: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Upgrade', upgradeSchema);