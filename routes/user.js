const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
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
const { io } = require('../server');
const {
  loginUser,
  registerUser,
  updateUserProfile,
  addPaymentMethod,
  getPaymentMethods,
  updatePaymentMethod,
  deletePaymentMethod,
  getReferralStats,
} = require('../controllers/userController');

// Retry Logic for Database Operations
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

// Generate Verification Code
const generateVerificationCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// Rate Limiter for Signup
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many signup attempts from this IP, please try again later.',
});

// Login
router.post('/login', loginUser);

// Signup with Email Verification
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

    let referredBy = null;
    if (referralCode) {
      const referrer = await withRetry(() => User.findOne({ referralCode }));
      if (referrer) {
        referredBy = referrer._id;
      }
    }

    const newUser = new User({
      fullName,
      username,
      email,
      phone,
      password: hashedPassword,
      referredBy,
      referralCode: generateVerificationCode(), // Use unique code
      level,
      status: 'pending',
      balance: { available: 0, pending: 0 },
      profileSet: false,
      tasksCompleted: 0,
      signupIP,
      verificationCode,
    });

    await withRetry(() => newUser.save());

    await sendEmail(
      email,
      'Email Verification - Daily Task Academy',
      `<p>Hello ${fullName},</p><p>Your verification code is: <b>${verificationCode}</b></p><p>Please verify your email and complete your payment of ₦${amount} to activate your account.</p>`
    );

    await withRetry(() => EmailLog.create({ type: 'verification', recipient: email }));

    if (referredBy) {
      const referrer = await withRetry(() => User.findById(referredBy));
      if (referrer) {
        referrer.referralBonus += 1000;
        referrer.invites += 1;
        await withRetry(() => referrer.save());
        await sendEmail(
          referrer.email,
          'You Referred a New User!',
          `<p>Great news! Someone just registered using your referral.</p><p>Keep referring to earn more!</p>`
        );
      }
    }

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
        status: newUser.status,
      },
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

// Verify Email
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

// Get User Profile
router.get('/profile', authMiddleware, updateUserProfile);

// Update User Profile
router.put('/profile', authMiddleware, updateUserProfile);

// Get Balance
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

// Get Payment Methods
router.get('/payment-methods', authMiddleware, getPaymentMethods);

// Add Payment Method
router.post('/payment-methods', authMiddleware, addPaymentMethod);

// Delete Payment Method
router.delete('/payment-methods/:id', authMiddleware, deletePaymentMethod);

// Transaction History
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const withdrawals = await withRetry(() => Withdrawal.find({ user: req.user.id }).populate('method'));
    const transactions = withdrawals.map(w => ({
      date: w.date.toISOString().split('T')[0],
      type: 'Withdrawal',
      amount: w.amount,
      description: `Withdrawal to ${w?.method?.type || 'Unknown method'}`,
      status: w.status,
    }));
    res.json(transactions);
  } catch (err) {
    Sentry.captureException(err);
    console.error('Transaction history error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Check Username Availability
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

// Pending Payment Check
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

// Confirm Deposit
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
      await sendEmail(
        user.email,
        'Registration Payment Confirmed',
        `<p>Hi ${user.fullName}, your registration payment of ₦${amount} has been confirmed. Welcome aboard!</p>`
      );
      await withRetry(() => EmailLog.create({ type: 'registration-payment', recipient: user.email }));
      io.to(user._id.toString()).emit('status-update', { status: 'active' });
    } else if (type === 'upgrade') {
      const upgrade = new Upgrade({ user: req.user.id, level, amount });
      await withRetry(() => upgrade.save());
      user.upgrades.push(upgrade._id);
      await withRetry(() => user.save());
      await sendEmail(
        user.email,
        'Upgrade Payment Confirmed',
        `<p>Hi ${user.fullName}, your upgrade payment of ₦${amount} to level ${level} has been confirmed.</p>`
      );
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

// Security Settings
router.put('/security', authMiddleware, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ message: 'New password is required' });

    const user = await withRetry(() => User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: 'User not found' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await withRetry(() => user.save());

    await sendEmail(
      user.email,
      'Password Updated',
      `<p>Hi ${user.fullName}, your password has been successfully updated.</p>`
    );
    await withRetry(() => EmailLog.create({ type: 'password-update', recipient: user.email }));

    res.json({ message: 'Security settings updated' });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Security settings error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Referrals
router.get('/referrals', authMiddleware, async (req, res) => {
  try {
    const referrals = await withRetry(() =>
      User.find({ referredBy: req.user.id }).select('fullName email username status')
    );
    res.json(referrals);
  } catch (err) {
    Sentry.captureException(err);
    console.error('Referrals fetch error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Referral Statistics
router.get('/referrals/stats', authMiddleware, getReferralStats);

// Request Upgrade
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

    await sendEmail(
      user.email,
      'Upgrade Requested',
      `<p>Your request to upgrade to level ${level} with ₦${amount} has been received and is pending confirmation.</p>`
    );
    await withRetry(() => EmailLog.create({ type: 'upgrade-request', recipient: user.email }));

    io.to(user._id.toString()).emit('upgrade-update', { level });
    res.json({ message: 'Upgrade request submitted', level: user.level });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Upgrade request error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Request Withdrawal
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
      date: new Date(),
    });
    await withRetry(() => withdrawal.save());

    user.balance.available -= amount;
    user.balance.pending += amount;
    await withRetry(() => user.save());

    await sendEmail(
      user.email,
      'Withdrawal Request Submitted',
      `<p>You have requested a withdrawal of ₦${amount}. It is now pending approval.</p>`
    );
    await withRetry(() => EmailLog.create({ type: 'withdrawal-request', recipient: user.email }));

    io.to(user._id.toString()).emit('balance-update', { balance: user.balance });
    res.status(201).json({ message: 'Withdrawal request submitted', withdrawalId: withdrawal._id });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Withdrawal request error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Task Completion
router.post('/tasks', authMiddleware, async (req, res) => {
  try {
    const { reward } = req.body;
    if (!reward || isNaN(reward) || reward <= 0) {
      return res.status(400).json({ message: 'Valid reward amount is required' });
    }

    const user = await withRetry(() => User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Optional: Prevent multiple tasks per day
    const today = new Date().toISOString().split('T')[0];
    if (user.lastTaskDate === today) {
      return res.status(400).json({ message: 'Task already completed today' });
    }

    user.tasksCompleted += 1;
    user.balance.available += parseFloat(reward);
    user.lastTaskDate = today;
    await withRetry(() => user.save());

    io.to(user._id.toString()).emit('balance-update', { balance: user.balance });
    io.to(user._id.toString()).emit('task-update', { tasksCompleted: user.tasksCompleted });

    res.status(200).json({
      id: user._id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      phone: user.phone,
      bank: user.bank,
      contact: user.contact,
      status: user.status,
      profileSet: user.profileSet,
      tasksCompleted: user.tasksCompleted,
      balance: user.balance,
      level: user.level,
      referralBonus: user.referralBonus,
      invites: user.invites,
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Task completion error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Referral Link Redirect
router.get('/ref/:referralCode', async (req, res) => {
  try {
    const { referralCode } = req.params;
    const user = await withRetry(() => User.findOne({ referralCode }));
    if (!user) {
      return res.status(404).json({ message: 'Referral code not found' });
    }
    // Redirect to signup page with referral code as query parameter
    res.redirect(`/signup.html?ref=${referralCode}`);
  } catch (err) {
    console.error('Referral link error:', err);
    Sentry.captureException(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;