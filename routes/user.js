const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const sendEmail = require('../utils/sendEmail');
const Sentry = require('@sentry/node');
const User = require('../models/User');
const PaymentMethod = require('../models/PaymentMethod');
const Withdrawal = require('../models/Withdrawal');
const Upgrade = require('../models/Upgrade');
const EmailLog = require('../models/EmailLog');
const { io } = require('../server'); // Assuming server.js exports io for Socket.IO

// ✅ Controllers
const { loginUser } = require('../controllers/userController');

// ✅ Retry Logic for Database Operations
async function withRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i))); // Exponential backoff
    }
  }
}

// ✅ Generate Verification Code
const generateVerificationCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// ✅ Rate Limiter for Signup
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many signup attempts from this IP, please try again later.'
});

// ✅ Login
router.post('/login', loginUser);

// ✅ Signup with Email Verification
router.post('/signup', signupLimiter, async (req, res) => {
  try {
    const { fullName, username, email, phone, password, referralCode, level, amount } = req.body;

    if (!fullName || !username || !email || !phone || !password || !level) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^[0-9]{10,15}$/;
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;

    if (!emailRegex.test(email)) return res.status(400).json({ message: 'Invalid email format' });
    if (!phoneRegex.test(phone)) return res.status(400).json({ message: 'Invalid phone number format' });
    if (!usernameRegex.test(username)) return res.status(400).json({ message: 'Invalid username format' });

    const existingUser = await withRetry(() => User.findOne({ $or: [{ email }, { username }] }));
    if (existingUser) return res.status(400).json({ message: 'Email or username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationCode = generateVerificationCode();
    const signupIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    console.log('Received signup body:', req.body);

    const newUser = new User({
      fullName: fullName,
      username,
      email,
      phone,
      password: hashedPassword,
      referredBy: referralCode || null,
      level,
      status: 'pending',
      balance: { available: 0, pending: 0 },
      profileSet: false,
      tasksCompleted: 0,
      signupIP,
      verificationCode
    });

    await withRetry(() => newUser.save());

    await sendEmail(email, 'Email Verification - Daily Task Academy', `
      <p>Hello ${name},</p>
      <p>Your verification code is: <b>${verificationCode}</b></p>
      <p>Please verify your email and complete your payment of ₦${amount} to activate your account.</p>
    `);

    await withRetry(() => EmailLog.create({ type: 'verification', recipient: email }));

    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: `User registered. Please verify your email and pay ₦${amount} for Level ${level}.`,
      token,
      user: {
        id: newUser._id,
        fullName: newUser.fullName,
        username: newUser.username,
        email: newUser.email,
        contact: newUser.contact,
        level: newUser.level,
        status: newUser.status
      }
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Signup error:', err.message);
    if (err.name === 'MongooseServerSelectionError') {
      return res.status(503).json({ message: 'Database unavailable. Please try again later.' });
    } else if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// ✅ Verify Email
router.post('/verify-email', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'Verification code is required' });

    const user = await withRetry(() => User.findOne({ verificationCode: code }));
    if (!user) return res.status(400).json({ message: 'Invalid verification code' });

    user.status = 'verified';
    user.verificationCode = null;
    await withRetry(() => user.save());

    await withRetry(() => EmailLog.create({ type: 'verification-complete', recipient: user.email }));

    io.to(user._id.toString()).emit('status-update', { status: 'verified' });
    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Verify email error:', err.message);
    if (err.name === 'MongooseServerSelectionError') {
      return res.status(503).json({ message: 'Database unavailable. Please try again later.' });
    }
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// ✅ Get User Profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await withRetry(() => User.findById(req.user.id).select('-password -verificationCode'));
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    Sentry.captureException(err);
    console.error('Profile fetch error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Update User Profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { username, bank, fullName, contact } = req.body;
    const user = await withRetry(() => User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.username = username || user.username;
    user.bank = bank || user.bank;
    user.fullName = fullName || user.fullName;
    user.contact = contact || user.contact;
    user.profileSet = true;

    await withRetry(() => user.save());
    io.to(user._id.toString()).emit('profile-update', { username, fullName, contact });
    res.json(user);
  } catch (err) {
    Sentry.captureException(err);
    console.error('Profile update error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Get Balance
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const user = await withRetry(() => User.findById(req.user.id).select('balance'));
    res.json(user?.balance || { available: 0, pending: 0 });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Balance fetch error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Get Payment Methods
router.get('/payment-methods', authMiddleware, async (req, res) => {
  try {
    const paymentMethods = await withRetry(() => PaymentMethod.find({ user: req.user.id }));
    res.json(paymentMethods);
  } catch (err) {
    Sentry.captureException(err);
    console.error('Payment methods fetch error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Add Payment Method
router.post('/payment-methods', authMiddleware, async (req, res) => {
  try {
    const { type, details } = req.body;
    if (!type || !details) return res.status(400).json({ message: 'Type and details are required' });

    const paymentMethod = new PaymentMethod({
      user: req.user.id,
      type,
      details
    });
    await withRetry(() => paymentMethod.save());
    res.status(201).json(paymentMethod);
  } catch (err) {
    Sentry.captureException(err);
    console.error('Add payment method error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Delete Payment Method
router.delete('/payment-methods/:id', authMiddleware, async (req, res) => {
  try {
    const paymentMethod = await withRetry(() => PaymentMethod.findById(req.params.id));
    if (!paymentMethod || paymentMethod.user.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Payment method not found' });
    }
    await withRetry(() => paymentMethod.deleteOne());
    res.json({ message: 'Payment method removed' });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Delete payment method error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Transaction History
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const withdrawals = await withRetry(() => Withdrawal.find({ user: req.user.id }).populate('method'));
    const transactions = withdrawals.map(w => ({
      date: w.date.toISOString().split('T')[0],
      type: 'Withdrawal',
      amount: w.amount,
      description: `Withdrawal to ${w?.method?.type || 'Unknown method'}`,
      status: w.status
    }));
    res.json(transactions);
  } catch (err) {
    Sentry.captureException(err);
    console.error('Transaction history error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Check Username Availability
router.get('/check-username', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ message: 'Username is required' });
    const user = await withRetry(() => User.findOne({ username }));
    res.json({ available: !user });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Check username error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Pending Payment Check
router.get('/pending-payment', authMiddleware, async (req, res) => {
  try {
    const user = await withRetry(() => User.findById(req.user.id));
    if (user.status === 'pending' && user.level) {
      const amount = 15000 * Math.pow(2, user.level - 1);
      return res.json({ amount, level: user.level, isUpgrade: false });
    }
    res.status(404).json({ message: 'No pending payment' });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Pending payment error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Confirm Deposit
router.post('/deposits', authMiddleware, async (req, res) => {
  try {
    const { amount, type, level } = req.body;
    if (!amount || !type) return res.status(400).json({ message: 'Amount and type are required' });

    const user = await withRetry(() => User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (type === 'registration') {
      user.status = 'active';
      user.balance.available += amount;
      await withRetry(() => user.save());
      await sendEmail(user.email, 'Registration Payment Confirmed', `<p>Hi ${user.fullName}, your registration payment of ₦${amount} has been confirmed. Welcome aboard!</p>`);
      await withRetry(() => EmailLog.create({ type: 'registration-payment', recipient: user.email }));
      io.to(user._id.toString()).emit('status-update', { status: 'active' });
    } else if (type === 'upgrade') {
      const upgrade = new Upgrade({ user: req.user.id, level, amount });
      await withRetry(() => upgrade.save());
      user.upgrades.push(upgrade._id);
      await withRetry(() => user.save());
      await sendEmail(user.email, 'Upgrade Payment Confirmed', `<p>Hi ${user.fullName}, your upgrade payment of ₦${amount} to level ${level} has been confirmed.</p>`);
      await withRetry(() => EmailLog.create({ type: 'upgrade-payment', recipient: user.email }));
      io.to(user._id.toString()).emit('upgrade-update', { level });
    }

    res.json({ message: 'Payment confirmed' });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Confirm deposit error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Security Settings
router.put('/security', authMiddleware, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ message: 'New password is required' });

    const user = await withRetry(() => User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: 'User not found' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await withRetry(() => user.save());

    await sendEmail(user.email, 'Password Updated', `<p>Hi ${user.fullName}, your password has been successfully updated.</p>`);
    await withRetry(() => EmailLog.create({ type: 'password-update', recipient: user.email }));

    res.json({ message: 'Security settings updated' });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Security settings error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Referrals
router.get('/referrals', authMiddleware, async (req, res) => {
  try {
    const referrals = await withRetry(() => User.find({ referredBy: req.user.id }).select('fullName email username status'));
    res.json(referrals);
  } catch (err) {
    Sentry.captureException(err);
    console.error('Referrals fetch error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Request Upgrade
router.post('/upgrade', authMiddleware, async (req, res) => {
  try {
    const { level, amount } = req.body;
    if (!level || !amount) return res.status(400).json({ message: 'Level and amount are required' });

    const user = await withRetry(() => User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (level <= user.level) return res.status(400).json({ message: 'New level must be higher than current level' });

    const upgrade = new Upgrade({ user: req.user.id, level, amount });
    await withRetry(() => upgrade.save());

    user.upgrades.push(upgrade._id);
    user.level = level;
    await withRetry(() => user.save());

    await sendEmail(user.email, 'Upgrade Requested', `<p>Your request to upgrade to level ${level} with ₦${amount} has been received and is pending confirmation.</p>`);
    await withRetry(() => EmailLog.create({ type: 'upgrade-request', recipient: user.email }));

    io.to(user._id.toString()).emit('upgrade-update', { level });
    res.json({ message: 'Upgrade request submitted', level: user.level });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Upgrade request error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Request Withdrawal
router.post('/withdrawals', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ message: 'Amount is required' });

    const user = await withRetry(() => User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (amount <= 0 || amount > user.balance.available) {
      return res.status(400).json({ message: 'Insufficient balance or invalid amount' });
    }

    const method = await withRetry(() => PaymentMethod.findOne({ user: user._id }));
    if (!method) return res.status(400).json({ message: 'No payment method found' });

    const withdrawal = new Withdrawal({
      user: user._id,
      amount,
      method: method._id,
      status: 'pending',
      date: new Date()
    });
    await withRetry(() => withdrawal.save());

    user.balance.available -= amount;
    user.balance.pending += amount;
    await withRetry(() => user.save());

    await sendEmail(user.email, 'Withdrawal Request Submitted', `<p>You have requested a withdrawal of ₦${amount}. It is now pending approval.</p>`);
    await withRetry(() => EmailLog.create({ type: 'withdrawal-request', recipient: user.email }));

    io.to(user._id.toString()).emit('balance-update', { balance: user.balance });
    res.status(201).json({ message: 'Withdrawal request submitted', withdrawalId: withdrawal._id });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Withdrawal request error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Task Completion
router.post('/tasks', authMiddleware, async (req, res) => {
  try {
    const user = await withRetry(() => User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.tasksCompleted += 1;
    user.balance.available += 500;
    await withRetry(() => user.save());

    io.to(user._id.toString()).emit('balance-update', { balance: user.balance });
    io.to(user._id.toString()).emit('task-update', { tasksCompleted: user.tasksCompleted });

    res.status(200).json({
      message: 'Task completed successfully',
      tasksCompleted: user.tasksCompleted,
      newBalance: user.balance.available
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Task completion error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;