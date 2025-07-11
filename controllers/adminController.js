const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const Task = require('../models/Task');
const Withdrawal = require('../models/Withdrawal');
const Referral = require('../models/Referral');
const Upgrade = require('../models/Upgrade');
const EmailLog = require('../models/EmailLog');

// Configure Nodemailer
//console.log('EMAIL_HOST:', process.env.EMAIL_HOST);
//console.log('EMAIL_PORT:', process.env.EMAIL_PORT);
//console.log('EMAIL_USER:', process.env.EMAIL_USER);
//console.log('EMAIL_PASS:', process.env.EMAIL_PASS);
console.log('✅ Email configuration loaded');


const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT || 587, // Default to 587 if not set
  secure: false, // false for port 587 (uses STARTTLS)
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: true // Enforce secure connection
  }
});

// Verify Nodemailer configuration on startup
transporter.verify((error, success) => {
  if (error) {
    console.error('Nodemailer configuration error:', error);
  } else {
    console.log('✅ Nodemailer is ready to send emails');
  }
});

// Generate random code
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// Helper function to emit dashboard updates via socket
const emitDashboardUpdate = async (req) => {
  const io = req.app.get('io');
  io.emit('dashboard-update', await fetchDashboardStats());
};

// Helper function to get dashboard stats
const fetchDashboardStats = async () => {
  try {
    const totalUsers = await User.countDocuments({ isAdmin: false });
    const totalEarnings = (await User.aggregate([
      { $match: { isAdmin: false } },
      { $group: { _id: null, total: { $sum: '$balance.available' } } },
    ]))[0]?.total || 0;
    const totalTasks = await Task.aggregate([
      { $group: { _id: null, total: { $sum: '$completions.length' } } },
    ])[0]?.total || 0;
    const totalWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
    return { totalUsers, totalEarnings, totalTasks, totalWithdrawals };
  } catch (error) {
    console.error('fetchDashboardStats error:', error.message, error.stack);
    throw new Error('Error fetching dashboard stats');
  }
};

// Admin Login (Modified to return user object for frontend socket)
const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.isAdmin) {
      return res.status(400).json({ message: 'Invalid admin credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid admin credentials' });
    }

    const token = jwt.sign(
      { id: user._id, isAdmin: user.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    // ✅ Return token AND user object
    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        level: user.level,
        status: user.status,
        role: user.isAdmin ? 'admin' : 'user'
      }
    });
  } catch (error) {
    console.error('Login error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get Admin Profile
const getProfile = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id).select('email contact avatar');
    if (!admin) return res.status(404).json({ message: 'Admin not found' });
    res.json(admin);
  } catch (error) {
    console.error('Get profile error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update Admin Profile
const updateProfile = async (req, res) => {
  const { email, password, contact } = req.body;
  try {
    const admin = await User.findById(req.user.id);
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    admin.email = email || admin.email;
    admin.contact = contact || admin.contact;
    if (password) {
      admin.password = await bcrypt.hash(password, 10);
    }
    await admin.save();
    res.json({ message: 'Profile updated' });
  } catch (error) {
    console.error('Update profile error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get Dashboard Stats
const getDashboardStats = async (req, res) => {
  try {
    const stats = await fetchDashboardStats();
    await emitDashboardUpdate(req);
    res.json(stats);
  } catch (error) {
    console.error('Dashboard stats error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
};

// Fetch All Users
const getUsers = async (req, res) => {
  try {
    const users = await User.find({ isAdmin: false }).select('fullName username email phone level status');
    res.json(users.map(user => ({
      _id: user._id,
      name: user.fullName,
      username: user.username,
      email: user.email,
      phone: user.phone,
      level: user.level,
      status: user.status,
    })));
  } catch (error) {
    console.error('Get users error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Fetch User Details
const getUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('fullName invites tasksCompleted');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ name: user.fullName, invites: user.invites, tasksCompleted: user.tasksCompleted });
  } catch (error) {
    console.error('Get user details error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update User Status
const updateUserStatus = async (req, res) => {
  const { status } = req.body;
  try {
    if (!['pending', 'verified', 'active', 'suspended'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.status = status;
    await user.save();
    res.json({ message: 'User status updated' });
  } catch (error) {
    console.error('Update user status error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete User
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    await user.deleteOne();
    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('Delete user error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Reset User Password
const resetUserPassword = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const newPassword = generateCode();
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'DTA Password Reset',
      text: `Your new password is: ${newPassword}. Please log in and change it immediately.`,
    };
    await transporter.sendMail(mailOptions);

    await EmailLog.create({ type: 'reset-password', recipient: user.email });
    res.json({ message: 'Password reset email sent' });
  } catch (error) {
    console.error('Reset password error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
};

// Confirm User Email
const confirmUserEmail = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.status = 'verified';
    user.verificationCode = null;
    await user.save();
    res.json({ message: 'Email confirmed' });
  } catch (error) {
    console.error('Confirm email error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Fetch Pending Confirmations
const getPendingConfirmations = async (req, res) => {
  try {
    const users = await User.find({ status: 'pending' }).select('fullName email phone level status referralCode createdAt');

    const pending = await Promise.all(users.map(async user => {
      const inviter = await User.findOne({ referralCode: user.referralCode });

      console.log(`User: ${user.fullName}, createdAt:`, user.createdAt);  // Debug log

      return {
        _id: user._id,
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        level: user.level,
        status: user.status,
        referralCode: user.referralCode || 'N/A',
        invitedBy: inviter ? inviter.fullName : 'Unknown',
        registrationDate: user.createdAt
          ? new Date(user.createdAt).toLocaleString('en-NG', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'N/A',
      };
    }));

    res.json(pending);
  } catch (error) {
    console.error('Get pending confirmations error:', error.message);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
};

// Resend Confirmation Code
const resendConfirmation = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const verificationCode = generateCode();
    user.verificationCode = verificationCode;
    await user.save();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'DTA Email Verification',
      text: `Your verification code is: ${verificationCode}`,
      html: `<p>Your verification code is: <b>${verificationCode}</b></p><p>Or click <a href="http://localhost:5000/api/auth/verify-email/${verificationCode}">here</a> to verify your email.</p>`,
    };
    await transporter.sendMail(mailOptions);

    await EmailLog.create({ type: 'verification', recipient: user.email });
    res.json({ message: 'Confirmation code resent' });
  } catch (error) {
    console.error('Resend confirmation error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
};

// Fetch All Tasks
const getTasks = async (req, res) => {
  try {
    const tasks = await Task.find().select('title link completions status');
    res.json(tasks.map(task => ({
      _id: task._id,
      title: task.title,
      "Rack up completions": task.completions.length,
      status: task.status,
    })));
  } catch (error) {
    console.error('Get tasks error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Create Task
const createTask = async (req, res) => {
  const { title, link, status } = req.body;
  try {
    if (!title || !link) {
      return res.status(400).json({ message: 'Title and link are required' });
    }
    const task = new Task({ title, link, status: status || 'active', reward: 300 });
    await task.save();
    res.json({ message: 'Task created' });
  } catch (error) {
    console.error('Create task error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Archive Task
const archiveTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    task.status = 'archived';
    await task.save();
    res.json({ message: 'Task archived' });
  } catch (error) {
    console.error('Archive task error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Unarchive Task
const unarchiveTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    task.status = 'active';
    await task.save();
    res.json({ message: 'Task unarchived' });
  } catch (error) {
    console.error('Unarchive task error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete Task
const deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    await task.deleteOne();
    res.json({ message: 'Task deleted' });
  } catch (error) {
    console.error('Delete task error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Fetch All Withdrawals
const getWithdrawals = async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find().populate('user', 'fullName');
    res.json(withdrawals.map(w => ({
      _id: w._id,
      userId: w.user._id,
      user: w.user.fullName,
      amount: w.amount,
      date: w.date,
      status: w.status,
    })));
  } catch (error) {
    console.error('Get withdrawals error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Approve Withdrawal
const approveWithdrawal = async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id).populate('user');
    if (!withdrawal) return res.status(404).json({ message: 'Withdrawal not found' });
    withdrawal.status = 'approved';
    await withdrawal.save();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: withdrawal.user.email,
      subject: 'DTA Withdrawal Approved',
      text: `Your withdrawal request of ₦${withdrawal.amount.toLocaleString()} has been approved.`,
    };
    await transporter.sendMail(mailOptions);

    await EmailLog.create({ type: 'notification', recipient: withdrawal.user.email });
    await emitDashboardUpdate(req);
    res.json({ message: 'Withdrawal approved' });
  } catch (error) {
    console.error('Approve withdrawal error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
};

// Decline Withdrawal
const declineWithdrawal = async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id).populate('user');
    if (!withdrawal) return res.status(404).json({ message: 'Withdrawal not found' });
    withdrawal.status = 'declined';
    const user = await User.findById(withdrawal.user._id);
    user.balance.available += withdrawal.amount;
    user.balance.pending -= withdrawal.amount;
    await user.save();
    await withdrawal.save();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: withdrawal.user.email,
      subject: 'DTA Withdrawal Declined',
      text: `Your withdrawal request of ₦${withdrawal.amount.toLocaleString()} has been declined. The amount has been returned to your available balance.`,
    };
    await transporter.sendMail(mailOptions);

    await EmailLog.create({ type: 'notification', recipient: withdrawal.user.email });
    await emitDashboardUpdate(req);
    res.json({ message: 'Withdrawal declined' });
  } catch (error) {
    console.error('Decline withdrawal error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
};

// Mark Withdrawal as Paid
const markWithdrawalAsPaid = async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id).populate('user');
    if (!withdrawal) return res.status(404).json({ message: 'Withdrawal not found' });
    withdrawal.status = 'paid';
    await withdrawal.save();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: withdrawal.user.email,
      subject: 'DTA Withdrawal Paid',
      text: `Your withdrawal of ₦${withdrawal.amount.toLocaleString()} has been paid.`,
    };
    await transporter.sendMail(mailOptions);

    await EmailLog.create({ type: 'notification', recipient: withdrawal.user.email });
    await emitDashboardUpdate(req);
    res.json({ message: 'Withdrawal marked as paid' });
  } catch (error) {
    console.error('Mark withdrawal as paid error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
};

// Fetch All Referrals
const getReferrals = async (req, res) => {
  try {
    const referralStats = await User.find({ isAdmin: false }).select('fullName invites referralBonus');
    res.json(referralStats.map(user => ({
      user: user.fullName,
      referralCount: user.invites,
      bonusPaid: user.referralBonus,
      isSuspicious: user.invites > 50,
    })));
  } catch (error) {
    console.error('Get referrals error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Fetch All Upgrades
const getUpgrades = async (req, res) => {
  try {
    const upgrades = await Upgrade.find().populate('user', 'fullName');
    res.json(upgrades.map(u => ({
      _id: u._id,
      user: u.user.fullName,
      level: u.level,
      amount: u.amount,
      status: u.status,
    })));
  } catch (error) {
    console.error('Get upgrades error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Approve Upgrade
const approveUpgrade = async (req, res) => {
  try {
    const upgrade = await Upgrade.findById(req.params.id).populate('user');
    if (!upgrade) return res.status(404).json({ message: 'Upgrade not found' });
    upgrade.status = 'approved';
    const user = await User.findById(upgrade.user._id);
    user.level = upgrade.level;
    user.status = 'active';
    await user.save();
    await upgrade.save();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: upgrade.user.email,
      subject: 'DTA Level Upgrade Approved',
      text: `Your upgrade to Level ${upgrade.level} has been approved.`,
    };
    await transporter.sendMail(mailOptions);

    await EmailLog.create({ type: 'notification', recipient: upgrade.user.email });
    res.json({ message: 'Upgrade approved' });
  } catch (error) {
    console.error('Approve upgrade error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
};

// Reject Upgrade
const rejectUpgrade = async (req, res) => {
  try {
    const upgrade = await Upgrade.findById(req.params.id).populate('user');
    if (!upgrade) return res.status(404).json({ message: 'Upgrade not found' });
    upgrade.status = 'rejected';
    await upgrade.save();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: upgrade.user.email,
      subject: 'DTA Level Upgrade Rejected',
      text: `Your upgrade to Level ${upgrade.level} has been rejected.`,
    };
    await transporter.sendMail(mailOptions);

    await EmailLog.create({ type: 'notification', recipient: upgrade.user.email });
    res.json({ message: 'Upgrade rejected' });
  } catch (error) {
    console.error('Reject upgrade error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
};

// Fetch All Admins
const getAdmins = async (req, res) => {
  try {
    const admins = await User.find({ isAdmin: true }).select('email contact');
    res.json(admins);
  } catch (error) {
    console.error('Get admins error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Invite New Admin
const inviteAdmin = async (req, res) => {
  const { email } = req.body;
  try {
    if (!email) return res.status(400).json({ message: 'Email is required' });
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: 'User already exists' });

    const temporaryPassword = generateCode();
    user = new User({
      email,
      password: await bcrypt.hash(temporaryPassword, 10),
      isAdmin: true,
      status: 'verified',
      contact: 'N/A',
    });
    await user.save();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'DTA Admin Invitation',
      text: `You have been invited to be an admin. Your temporary password is: ${temporaryPassword}. Please log in and change it.`,
    };
    await transporter.sendMail(mailOptions);

    await EmailLog.create({ type: 'notification', recipient: email });
    res.json({ message: 'Invite sent' });
  } catch (error) {
    console.error('Invite admin error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
};

// Fetch Email Logs
const getEmailLogs = async (req, res) => {
  try {
    const logs = await EmailLog.find().sort({ timestamp: -1 });
    res.json(logs);
  } catch (error) {
    console.error('Get email logs error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error' });
  }
};

// Send Notification to All Users
const sendNotification = async (req, res) => {
  const { message } = req.body;
  try {
    if (!message) return res.status(400).json({ message: 'Message is required' });
    const users = await User.find({ isAdmin: false });
    if (users.length === 0) return res.status(404).json({ message: 'No users found' });

    // Verify transporter
    await new Promise((resolve, reject) => {
      transporter.verify((error, success) => {
        if (error) {
          console.error('Transporter verification failed:', error);
          reject(error);
        } else {
          console.log('Transporter verified successfully');
          resolve(success);
        }
      });
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      subject: 'DTA Notification',
      text: message,
    };

    for (const user of users) {
      mailOptions.to = user.email;
      console.log(`Attempting to send email to ${user.email}`);
      await transporter.sendMail(mailOptions).catch(err => {
        console.error(`Failed to send email to ${user.email}:`, err.message, err.stack);
      });
      await EmailLog.create({ type: 'notification', recipient: user.email });
    }

    const io = req.app.get('io');
    io.emit('notification', { message });
    res.json({ message: 'Notification sent' });
  } catch (error) {
    console.error('Send notification error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
};

module.exports = {
  login,
  getProfile,
  updateProfile,
  getDashboardStats,
  getUsers,
  getUserDetails,
  updateUserStatus,
  deleteUser,
  resetUserPassword,
  confirmUserEmail,
  getPendingConfirmations,
  resendConfirmation,
  getTasks,
  createTask,
  archiveTask,
  unarchiveTask,
  deleteTask,
  getWithdrawals,
  approveWithdrawal,
  declineWithdrawal,
  markWithdrawalAsPaid,
  getReferrals,
  getUpgrades,
  approveUpgrade,
  rejectUpgrade,
  getAdmins,
  inviteAdmin,
  getEmailLogs,
  sendNotification,
};