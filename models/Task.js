const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  link: { type: String, required: true },
  reward: { type: Number, required: true },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  completions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

module.exports = mongoose.model('Task', taskSchema);