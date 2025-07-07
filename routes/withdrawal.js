const express = require('express');
const router = express.Router();
const { adminMiddleware } = require('../middleware/auth');
const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const Task = require('../models/Task');


router.get('/', adminMiddleware, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find().populate('user').populate('paymentMethod').lean();
    res.json(
      withdrawals.map((w) => ({
        _id: w._id.toString(),
        userId: w.user._id.toString(),
        amount: w.amount,
        date: w.createdAt,
        status: w.status,
      }))
    );
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/approve', adminMiddleware, async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
    withdrawal.status = 'approved';
    await withdrawal.save();

    const transaction = await Transaction.findOne({
      user: withdrawal.user,
      amount: -withdrawal.amount,
      type: 'Withdrawal',
      status: 'pending',
    });
    if (transaction) {
      transaction.status = 'completed';
      await transaction.save();
    }

    // Emit dashboard updates
    const totalUsers = await User.countDocuments();
    const totalEarnings = await User.aggregate([{ $group: { _id: null, total: { $sum: '$balance.available' } } }]);
    const totalTasks = await Task.aggregate([
      { $match: { 'completions.0': { $exists: true } } },
      { $group: { _id: null, total: { $sum: { $size: '$completions' } } } },
    ]);
    const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
    req.app.get('io').emit('dashboard-update', {
      totalUsers,
      totalEarnings: totalEarnings[0]?.total || 0,
      taskCompletions: totalTasks[0]?.total || 0,
      pendingWithdrawals,
    });

    res.json({ message: 'Withdrawal approved' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/decline', adminMiddleware, async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id).populate('user');
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
    withdrawal.status = 'declined';
    await withdrawal.save();

    const user = await User.findById(withdrawal.user._id);
    user.balance.available += withdrawal.amount;
    user.balance.pending -= withdrawal.amount;
    await user.save();

    const transaction = await Transaction.findOne({
      user: withdrawal.user,
      amount: -withdrawal.amount,
      type: 'Withdrawal',
      status: 'pending',
    });
    if (transaction) {
      transaction.status = 'failed';
      await transaction.save();
    }

    const notification = new Notification({
      user: withdrawal.user._id,
      message: `Withdrawal request of ₦${withdrawal.amount.toLocaleString()} declined`,
    });
    await notification.save();

    // Emit dashboard updates
    const totalUsers = await User.countDocuments();
    const totalEarnings = await User.aggregate([{ $group: { _id: null, total: { $sum: '$balance.available' } } }]);
    const totalTasks = await Task.aggregate([
      { $match: { 'completions.0': { $exists: true } } },
      { $group: { _id: null, total: { $sum: { $size: '$completions' } } } },
    ]);
    const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
    req.app.get('io').emit('dashboard-update', {
      totalUsers,
      totalEarnings: totalEarnings[0]?.total || 0,
      taskCompletions: totalTasks[0]?.total || 0,
      pendingWithdrawals,
    });

    res.json({ message: 'Withdrawal declined' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/paid', adminMiddleware, async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id).populate('user');
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
    if (withdrawal.status !== 'approved') return res.status(400).json({ error: 'Withdrawal must be approved first' });

    withdrawal.status = 'paid';
    await withdrawal.save();

    const user = await User.findById(withdrawal.user._id);
    user.balance.pending -= withdrawal.amount;
    await user.save();

    const notification = new Notification({
      user: withdrawal.user._id,
      message: `Withdrawal of ₦${withdrawal.amount.toLocaleString()} marked as paid`,
    });
    await notification.save();

    // Emit dashboard updates
    const totalUsers = await User.countDocuments();
    const totalEarnings = await User.aggregate([{ $group: { _id: null, total: { $sum: '$balance.available' } } }]);
    const totalTasks = await Task.aggregate([
      { $match: { 'completions.0': { $exists: true } } },
      { $group: { _id: null, total: { $sum: { $size: '$completions' } } } },
    ]);
    const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
    req.app.get('io').emit('dashboard-update', {
      totalUsers,
      totalEarnings: totalEarnings[0]?.total || 0,
      taskCompletions: totalTasks[0]?.total || 0,
      pendingWithdrawals,
    });

    res.json({ message: 'Withdrawal marked as paid' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
