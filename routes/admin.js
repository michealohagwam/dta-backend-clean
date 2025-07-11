const express = require('express');
const router = express.Router();

const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const adminController = require('../controllers/adminController');

// Models
const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const Task = require('../models/Task');
const Referral = require('../models/Referral');

// ==============================
// 📌 Admin Authentication & Profile
// ==============================
router.post('/login', adminController.login);
router.get('/profile', [authMiddleware, adminMiddleware], adminController.getProfile);
router.put('/profile', [authMiddleware, adminMiddleware], adminController.updateProfile);

// ==============================
// 📊 Dashboard
// ==============================
router.get('/dashboard-stats', [authMiddleware, adminMiddleware], adminController.getDashboardStats);

// ==============================
// 👤 User Management
// ==============================
router.get('/users', [authMiddleware, adminMiddleware], adminController.getUsers);
router.get('/users/pending-confirmations', [authMiddleware, adminMiddleware], adminController.getPendingConfirmations);
router.get('/users/:id', [authMiddleware, adminMiddleware], adminController.getUserDetails);
router.put('/users/:id/status', [authMiddleware, adminMiddleware], adminController.updateUserStatus);
router.delete('/users/:id', [authMiddleware, adminMiddleware], adminController.deleteUser);
router.post('/users/:id/reset-password', [authMiddleware, adminMiddleware], adminController.resetUserPassword);
router.post('/users/:id/confirm-email', [authMiddleware, adminMiddleware], adminController.confirmUserEmail);
router.post('/users/:id/resend-confirmation', [authMiddleware, adminMiddleware], adminController.resendConfirmation);

// ==============================
// 💸 Withdrawals
// ==============================
router.get('/withdrawals', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find().populate('user').populate('paymentMethod').lean();
    res.json(withdrawals.map(w => ({
      _id: w._id.toString(),
      userId: w.user._id.toString(),
      amount: w.amount,
      date: w.createdAt,
      status: w.status
    })));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/withdrawals/:id/approve', [authMiddleware, adminMiddleware], async (req, res) => {
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

    await emitDashboardUpdate(req.app);
    res.json({ message: 'Withdrawal approved' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/withdrawals/:id/decline', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id).populate('user');
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });

    const user = await User.findById(withdrawal.user._id);
    user.balance.available += withdrawal.amount;
    user.balance.pending -= withdrawal.amount;
    await user.save();

    withdrawal.status = 'declined';
    await withdrawal.save();

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

    await emitDashboardUpdate(req.app);
    res.json({ message: 'Withdrawal declined' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/withdrawals/:id/paid', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id).populate('user');
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
    if (withdrawal.status !== 'approved') return res.status(400).json({ error: 'Must be approved first' });

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

    await emitDashboardUpdate(req.app);
    res.json({ message: 'Withdrawal marked as paid' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==============================
// ✅ Task Management
// ==============================
router.get('/tasks', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const tasks = await Task.find().lean();
    res.json(tasks.map(t => ({
      _id: t._id.toString(),
      title: t.title,
      link: t.link,
      completions: t.completions.length,
      status: t.status
    })));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/tasks', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { title, link, status } = req.body;
    if (!title || !link || !status) return res.status(400).json({ error: 'Missing required fields' });

    const task = new Task({ title, link, status, reward: 300 });
    await task.save();

    // Emit event to users on level 1–6
    const io = req.app.get('io');
    const users = await User.find({ level: { $gte: 1, $lte: 6 } });

    users.forEach(user => {
      io.to(user._id.toString()).emit('new-task', {
        _id: task._id.toString(),
        title: task.title,
        link: task.link,
        status: task.status
      });
    });

    res.status(201).json({
      _id: task._id.toString(),
      title: task.title,
      link: task.link,
      completions: task.completions.length,
      status: task.status,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/tasks/:id/archive', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, { status: 'archived' }, { new: true });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ message: 'Task archived' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/tasks/:id/unarchive', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, { status: 'active' }, { new: true });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ message: 'Task unarchived' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/tasks/:id', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==============================
// 🤝 Referrals
// ==============================
router.get('/referrals', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const referrals = await Referral.find().populate('referrer referredUser').lean();
    const statsMap = {};

    referrals.forEach(ref => {
      const referrerId = ref.referrer?._id?.toString();
      if (!referrerId) return;

      if (!statsMap[referrerId]) {
        statsMap[referrerId] = {
          user: ref.referrer.fullName,
          referralCount: 0,
          bonusPaid: 0,
          isSuspicious: false,
        };
      }

      statsMap[referrerId].referralCount += 1;
      statsMap[referrerId].bonusPaid += ref.bonus || 0;
      statsMap[referrerId].isSuspicious = statsMap[referrerId].isSuspicious || ref.suspicious;
    });

    res.json(Object.values(statsMap));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==============================
// 🧰 Upgrades, Admins, Emails, Notifications
// ==============================
router.get('/upgrades', [authMiddleware, adminMiddleware], adminController.getUpgrades);
router.post('/upgrades/:id/approve', [authMiddleware, adminMiddleware], adminController.approveUpgrade);
router.post('/upgrades/:id/reject', [authMiddleware, adminMiddleware], adminController.rejectUpgrade);

router.get('/admins', [authMiddleware, adminMiddleware], adminController.getAdmins);
router.post('/invite', [authMiddleware, adminMiddleware], adminController.inviteAdmin);

router.get('/emails', [authMiddleware, adminMiddleware], adminController.getEmailLogs);
router.post('/notifications', [authMiddleware, adminMiddleware], adminController.sendNotification);

// ==============================
// 📡 Emit Dashboard Updates Helper
// ==============================
async function emitDashboardUpdate(app) {
  const totalUsers = await User.countDocuments();
  const totalEarnings = await User.aggregate([{ $group: { _id: null, total: { $sum: '$balance.available' } } }]);
  const totalTasks = await Task.aggregate([
    { $match: { 'completions.0': { $exists: true } } },
    { $group: { _id: null, total: { $sum: { $size: '$completions' } } } },
  ]);
  const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });

  app.get('io').emit('dashboard-update', {
    totalUsers,
    totalEarnings: totalEarnings[0]?.total || 0,
    taskCompletions: totalTasks[0]?.total || 0,
    pendingWithdrawals,
  });
}

module.exports = router;
