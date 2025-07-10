const express = require('express');
const router = express.Router();

// Dependencies
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const sendEmail = require('../utils/sendEmail');

// Models
const User = require('../models/User');
const PaymentMethod = require('../models/PaymentMethod');
const Withdrawal = require('../models/Withdrawal');
const Upgrade = require('../models/Upgrade');
const EmailLog = require('../models/EmailLog');

// Middleware & Controllers
const { authMiddleware } = require('../middleware/auth');
const { loginUser } = require('../controllers/userController');

// Utilities
const generateVerificationCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// Rate Limiting
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many signup attempts from this IP. Please try again later.',
});

// ====================
// 🔐 Authentication
// ====================

// Login
router.post('/login', loginUser);

// Signup
router.post('/signup', signupLimiter, async (req, res) => {
  try {
    const { name, username, email, phone, password, referralCode, level, amount } = req.body;

    if (!name || !username || !email || !phone || !password || !level) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^[0-9]{10,15}$/;
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;

    if (!emailRegex.test(email)) return res.status(400).json({ message: 'Invalid email format' });
    if (!phoneRegex.test(phone)) return res.status(400).json({ message: 'Invalid phone number format' });
    if (!usernameRegex.test(username)) return res.status(400).json({ message: 'Invalid username format' });

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) return res.status(400).json({ message: 'Email or username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationCode = generateVerificationCode();
    const signupIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const newUser = new User({
      fullName: name,
      username,
      email,
      contact: phone,
      password: hashedPassword,
      referredBy: referralCode || null,
      level,
      status: 'pending',
      balance: { available: 0, pending: 0 },
      profileSet: false,
      tasksCompleted: 0,
      signupIP,
      verificationCode,
    });

    await newUser.save();

    await sendEmail(email, 'Email Verification - Daily Task Academy', `
      <p>Hello ${name},</p>
      <p>Your verification code is: <b>${verificationCode}</b></p>
    `);

    await EmailLog.create({ type: 'verification', recipient: email });

    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: `User registered successfully. Please verify your email.`,
      token,
    });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// Verify Email
router.post('/verify-email', async (req, res) => {
  const { code } = req.body;
  try {
    const user = await User.findOne({ verificationCode: code });
    if (!user) return res.status(400).json({ message: 'Invalid verification code' });

    user.status = 'verified';
    user.verificationCode = null;
    await user.save();

    await EmailLog.create({ type: 'verification-complete', recipient: user.email });

    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ====================
// 👤 Profile Management
// ====================

// Get Profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -verificationCode');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update Profile
router.put('/profile', authMiddleware, async (req, res) => {
  const { username, bank, fullName, contact } = req.body;
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.username = username || user.username;
    user.bank = bank || user.bank;
    user.fullName = fullName || user.fullName;
    user.contact = contact || user.contact;
    user.profileSet = true;

    await user.save();

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Check Username Availability
router.get('/check-username', async (req, res) => {
  const { username } = req.query;
  try {
    const user = await User.findOne({ username });
    res.json({ available: !user });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ====================
// 💰 Balance & Transactions
// ====================

// Get Balance
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('balance');
    res.json(user?.balance || { available: 0, pending: 0 });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Transaction History
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ user: req.user.id }).populate('method');
    const transactions = withdrawals.map(w => ({
      date: w.date.toISOString().split('T')[0],
      type: 'Withdrawal',
      amount: w.amount,
      description: `Withdrawal to ${w?.method?.type || 'Unknown method'}`,
      status: w.status,
    }));
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Pending Payment
router.get('/pending-payment', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (user.status === 'pending' && user.level) {
      const amount = 15000 * Math.pow(2, user.level - 1);
      return res.json({ amount, level: user.level, isUpgrade: false });
    }
    res.status(404).json({ message: 'No pending payment' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Confirm Deposit
router.post('/deposits', authMiddleware, async (req, res) => {
  const { amount, type, level } = req.body;
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (type === 'registration') {
      user.status = 'active';
      user.balance.available += amount;
      await sendEmail(user.email, 'Registration Payment Confirmed', `<p>Hi ${user.fullName}, your registration payment of ₦${amount} has been confirmed. Welcome aboard!</p>`);
    } else if (type === 'upgrade') {
      const upgrade = new Upgrade({ user: req.user.id, level, amount });
      await upgrade.save();
      user.upgrades.push(upgrade._id);
      await sendEmail(user.email, 'Upgrade Payment Confirmed', `<p>Hi ${user.fullName}, your upgrade payment of ₦${amount} to level ${level} has been confirmed.</p>`);
    }

    await user.save();
    res.json({ message: 'Payment confirmed' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Security Settings
router.put('/security', authMiddleware, async (req, res) => {
  const { newPassword } = req.body;
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (newPassword) {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword;
    }

    await user.save();
    res.json({ message: 'Security settings updated' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ====================
// 💸 Payments
// ====================

// Payment Methods
router.get('/payment-methods', authMiddleware, async (req, res) => {
  try {
    const paymentMethods = await PaymentMethod.find({ user: req.user.id });
    res.json(paymentMethods);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Add Payment Method
router.post('/payment-methods', authMiddleware, async (req, res) => {
  const { type, details } = req.body;
  try {
    const paymentMethod = new PaymentMethod({
      user: req.user.id,
      type,
      details,
    });
    await paymentMethod.save();
    res.status(201).json(paymentMethod);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete Payment Method
router.delete('/payment-methods/:id', authMiddleware, async (req, res) => {
  try {
    const paymentMethod = await PaymentMethod.findById(req.params.id);
    if (!paymentMethod || paymentMethod.user.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Payment method not found' });
    }
    await paymentMethod.deleteOne();
    res.json({ message: 'Payment method removed' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Withdrawals
router.post('/withdrawals', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (amount <= 0 || amount > user.balance.available) {
      return res.status(400).json({ message: 'Insufficient balance or invalid amount' });
    }

    const method = await PaymentMethod.findOne({ user: user._id });
    if (!method) return res.status(400).json({ message: 'No payment method found' });

    const withdrawal = new Withdrawal({
      user: user._id,
      amount,
      method: method._id,
      status: 'pending',
      date: new Date(),
    });

    await withdrawal.save();

    user.balance.available -= amount;
    user.balance.pending += amount;
    await user.save();

    await sendEmail(user.email, 'Withdrawal Request Submitted', `<p>You have requested a withdrawal of ₦${amount}. It is now pending approval.</p>`);
    res.status(201).json({ message: 'Withdrawal request submitted', withdrawalId: withdrawal._id });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ====================
// 🚀 Referrals & Upgrades
// ====================

// Referrals
router.get('/referrals', authMiddleware, async (req, res) => {
  try {
    const referrals = await User.find({ referredBy: req.user.id }).select('fullName email username status');
    res.json(referrals);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Request Upgrade
router.post('/upgrade', authMiddleware, async (req, res) => {
  const { level, amount } = req.body;
  try {
    if (!level || !amount) return res.status(400).json({ message: 'Level and amount are required' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (level <= user.level) return res.status(400).json({ message: 'New level must be higher than current level' });

    const upgrade = new Upgrade({ user: req.user.id, level, amount });
    await upgrade.save();
    user.upgrades.push(upgrade._id);
    user.level = level;
    await user.save();

    await sendEmail(user.email, 'Upgrade Requested', `<p>Your request to upgrade to level ${level} with ₦${amount} has been received and is pending confirmation.</p>`);
    res.json({ message: 'Upgrade request submitted', level: user.level });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ====================
// 🧠 Task System
// ====================

// Complete Task
router.post('/tasks', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.tasksCompleted += 1;
    user.balance.available += 500;
    await user.save();

    res.status(200).json({
      message: 'Task completed successfully',
      tasksCompleted: user.tasksCompleted,
      newBalance: user.balance.available,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;