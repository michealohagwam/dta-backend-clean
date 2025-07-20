const User = require('../models/User');
const PaymentMethod = require('../models/PaymentMethod');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/sendEmail');
const Sentry = require('@sentry/node');

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

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await withRetry(() => User.findOne({ email }));
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid password' });

    const token = jwt.sign(
      { id: user._id, isAdmin: user.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        username: user.username,
        isAdmin: user.isAdmin,
        status: user.status,
        referralCode: user.referralCode || user.username,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    Sentry.captureException(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Register user
// @route   POST /api/users/register
// @access  Public
const registerUser = async (req, res) => {
  const { fullName, email, password, username, referralCode } = req.body;

  try {
    if (username === 'undefined' || typeof username !== 'string') {
      return res.status(400).json({ message: 'Invalid username' });
    }

    const existingUser = await withRetry(() =>
      User.findOne({
        $or: [{ email }, { username }, { referralCode: username }],
      })
    );

    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(400).json({ message: 'Email already exists, please choose another' });
      } else if (existingUser.username === username || existingUser.referralCode === username) {
        return res.status(400).json({ message: 'Username already exists or is used as a referral code' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let referredBy = null;
    if (referralCode && referralCode !== 'undefined') {
      const referrer = await withRetry(() => User.findOne({ $or: [{ referralCode }, { username: referralCode }] }));
      if (!referrer) {
        return res.status(400).json({ message: 'Invalid referral code' });
      }
      referredBy = referrer._id;
    }

    const newUser = new User({
      fullName,
      email,
      username,
      password: hashedPassword,
      referredBy,
      referralCode: username,
    });

    await withRetry(() => newUser.save());

    await sendEmail(
      email,
      'Welcome to DailyTask Academy',
      `<p>Hello ${fullName},</p><p>Welcome to DailyTask Academy! Your account has been successfully created.</p>`
    );

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

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: newUser._id,
        fullName: newUser.fullName,
        username: newUser.username,
        email: newUser.email,
        referralCode: newUser.referralCode,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    Sentry.captureException(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update user profile
// @route   GET|PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const user = await withRetry(() => User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (req.method === 'PUT') {
      user.fullName = req.body.fullName || user.fullName;
      user.username = req.body.username || user.username;
      user.bank = req.body.bank || user.bank;
      user.contact = req.body.contact || user.contact;
      user.profileSet = true;

      // If username is updated, ensure referralCode is updated and unique
      if (req.body.username && req.body.username !== user.username) {
        const existingUser = await withRetry(() => User.findOne({ $or: [{ username: req.body.username }, { referralCode: req.body.username }] }));
        if (existingUser) {
          return res.status(400).json({ message: 'Username or referral code already exists' });
        }
        user.username = req.body.username;
        user.referralCode = req.body.username;
      }

      await withRetry(() => user.save());
    }

    const response = {
      id: user._id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      phone: user.phone,
      bank: user.bank,
      contact: user.contact,
      status: user.status,
      profileSet: user.profileSet,
      referralCode: user.referralCode || user.username,
    };
    console.log('Profile response:', response); // Debug log
    res.json(response);
  } catch (err) {
    console.error('Update profile error:', err);
    Sentry.captureException(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Add payment method
// @route   POST /api/users/payment-methods
// @access  Private
const addPaymentMethod = async (req, res) => {
  const { type, bank, accountNumber, email } = req.body;

  try {
    const details = type === 'Bank Account' ? { bank, accountNumber } : { email };
    const paymentMethod = new PaymentMethod({
      user: req.user.id,
      type,
      details,
    });

    await withRetry(() => paymentMethod.save());
    res.status(201).json({
      message: 'Payment method added',
      method: {
        id: paymentMethod._id,
        type: paymentMethod.type,
        ...paymentMethod.details,
      },
    });
  } catch (err) {
    console.error('Add payment method error:', err);
    Sentry.captureException(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get payment methods
// @route   GET /api/users/payment-methods
// @access  Private
const getPaymentMethods = async (req, res) => {
  try {
    const methods = await withRetry(() => PaymentMethod.find({ user: req.user.id }));
    const formattedMethods = methods.map(method => ({
      id: method._id,
      type: method.type,
      ...method.details,
    }));
    res.json(formattedMethods);
  } catch (err) {
    console.error('Get payment methods error:', err);
    Sentry.captureException(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update payment method
// @route   PUT /api/users/payment-methods/:id
// @access  Private
const updatePaymentMethod = async (req, res) => {
  const { type, bank, accountNumber, email } = req.body;

  try {
    const method = await withRetry(() => PaymentMethod.findById(req.params.id));
    if (!method || method.user.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Payment method not found' });
    }

    method.type = type || method.type;
    method.details = type === 'Bank Account' ? { bank, accountNumber } : { email } || method.details;

    await withRetry(() => method.save());
    res.json({
      message: 'Payment method updated',
      method: {
        id: method._id,
        type: method.type,
        ...method.details,
      },
    });
  } catch (err) {
    console.error('Update payment method error:', err);
    Sentry.captureException(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete payment method
// @route   DELETE /api/users/payment-methods/:id
// @access  Private
const deletePaymentMethod = async (req, res) => {
  try {
    const method = await withRetry(() => PaymentMethod.findById(req.params.id));
    if (!method || method.user.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Payment method not found' });
    }

    await withRetry(() => method.deleteOne());
    res.json({ message: 'Payment method deleted successfully' });
  } catch (err) {
    console.error('Delete payment method error:', err);
    Sentry.captureException(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get referral statistics
// @route   GET /api/users/referrals/stats
// @access  Private
const getReferralStats = async (req, res) => {
  try {
    const user = await withRetry(() => User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: 'User not found' });

    const referralCount = await withRetry(() => User.countDocuments({ referredBy: req.user.id }));
    const referralEarnings = user.referralBonus || 0;

    res.json({
      count: referralCount,
      earnings: referralEarnings,
    });
  } catch (err) {
    console.error('Referral stats fetch error:', err);
    Sentry.captureException(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Notify upgrade
const notifyUpgrade = async (user, level, amount) => {
  try {
    await sendEmail(
      user.email,
      'Level Upgrade Successful',
      `<p>Hi ${user.fullName},</p><p>Your account has been successfully upgraded to level ${level}.</p><p>Upgrade amount: ${amount}</p>`
    );
  } catch (err) {
    console.error('Notify upgrade error:', err);
    Sentry.captureException(err);
  }
};

// @desc    Notify withdrawal
const notifyWithdrawal = async (user, amount) => {
  try {
    await sendEmail(
      user.email,
      'Withdrawal Request Received',
      `<p>Hello ${user.fullName},</p><p>Your withdrawal request of ${amount} has been received and is pending processing.</p>`
    );
  } catch (err) {
    console.error('Notify withdrawal error:', err);
    Sentry.captureException(err);
  }
};

module.exports = {
  loginUser,
  registerUser,
  updateUserProfile,
  notifyUpgrade,
  notifyWithdrawal,
  addPaymentMethod,
  getPaymentMethods,
  updatePaymentMethod,
  deletePaymentMethod,
  getReferralStats,
};