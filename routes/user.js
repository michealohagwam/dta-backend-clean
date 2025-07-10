const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// ✅ Middleware
const { authMiddleware } = require('../middleware/auth');

// ✅ Controllers
const { loginUser } = require('../controllers/userController');

// ✅ Utils
const sendEmail = require('../utils/sendEmail');

// ✅ Models
const User = require('../models/User');
const PaymentMethod = require('../models/PaymentMethod');
const Withdrawal = require('../models/Withdrawal');
const Upgrade = require('../models/Upgrade');

// ✅ Login
router.post('/login', loginUser);

// ✅ Signup
router.post('/signup', async (req, res) => {
  try {
    const { name, username, email, phone, password, referralCode, level, amount } = req.body;

    if (!name || !username || !email || !phone || !password || !level) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ message: 'Username already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

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
      tasksCompleted: 0
    });

    await newUser.save();

    await sendEmail(email, 'Welcome to Daily Task Academy', `<p>Hello ${name}, welcome! Please complete your payment of ₦${amount} to activate your account.</p>`);

    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'User registered successfully',
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
    console.error('Signup error:', err.message);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// ✅ Get user profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -verificationCode');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Update user profile
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

// ✅ Get balance
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('balance');
    res.json(user?.balance || { available: 0, pending: 0 });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Get payment methods
router.get('/payment-methods', authMiddleware, async (req, res) => {
  try {
    const paymentMethods = await PaymentMethod.find({ user: req.user.id });
    res.json(paymentMethods);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Add payment method
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

// ✅ Delete payment method
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

// ✅ Transaction history
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

// ✅ Check username availability
router.get('/check-username', async (req, res) => {
  const { username } = req.query;
  try {
    const user = await User.findOne({ username });
    res.json({ available: !user });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Pending payment check
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

// ✅ Confirm deposit
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

// ✅ Security settings
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

// ✅ Referrals
router.get('/referrals', authMiddleware, async (req, res) => {
  try {
    const referrals = await User.find({ referredBy: req.user.id }).select('fullName email username status');
    res.json(referrals);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Request upgrade
router.post('/upgrade', authMiddleware, async (req, res) => {
  const { level, amount } = req.body;
  try {
    if (!level || !amount) {
      return res.status(400).json({ message: 'Level and amount are required' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (level <= user.level) {
      return res.status(400).json({ message: 'New level must be higher than current level' });
    }

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

// ✅ Request withdrawal
router.post('/withdrawals', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (amount <= 0 || amount > user.balance.available) {
      return res.status(400).json({ message: 'Insufficient balance or invalid amount' });
    }

    const method = await PaymentMethod.findOne({ user: user._id });
    if (!method) {
      return res.status(400).json({ message: 'No payment method found' });
    }

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

// ✅ Task completion
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
