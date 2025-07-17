const User = require('../models/User');
const PaymentMethod = require('../models/PaymentMethod');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/sendEmail');

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
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
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Register user
// @route   POST /api/users/register
// @access  Public
const registerUser = async (req, res) => {
  const { fullName, email, password, username, referredBy } = req.body;

  try {
    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      if (existingUser.email === email && existingUser.username === username) {
        return res.status(400).json({ message: 'Both email and username already exist' });
      } else if (existingUser.email === email) {
        return res.status(400).json({ message: 'Email already exists, please choose another' });
      } else if (existingUser.username === username) {
        return res.status(400).json({ message: 'Username already exists, please choose another' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      fullName,
      email,
      username,
      password: hashedPassword,
      referredBy,
    });

    await newUser.save();

    await sendEmail(
      email,
      'Welcome to DailyTask Academy',
      `<p>Hello ${fullName},</p><p>Welcome to DailyTask Academy! Your account has been successfully created.</p>`
    );

    if (referredBy) {
      const referrer = await User.findById(referredBy);
      if (referrer) {
        await sendEmail(
          referrer.email,
          'You Referred a New User!',
          `<p>Great news! Someone just registered using your referral.</p><p>Keep referring to earn more!</p>`
        );
      }
    }

    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.fullName = req.body.fullName || user.fullName;
    user.contact = req.body.contact || user.contact;
    user.profileSet = true;

    await user.save();

    res.json({
      id: user._id,
      fullName: user.fullName,
      contact: user.contact,
      email: user.email,
      username: user.username,
      status: user.status,
      profileSet: user.profileSet,
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Add payment method
// @route   POST /api/users/payment-methods
// @access  Private
const addPaymentMethod = async (req, res) => {
  const { type, details } = req.body;

  try {
    const paymentMethod = new PaymentMethod({
      user: req.user.id,
      type,
      details,
    });

    await paymentMethod.save();
    res.status(201).json({ message: 'Payment method added', method: paymentMethod });
  } catch (err) {
    console.error('Add payment method error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get payment methods
// @route   GET /api/users/payment-methods
// @access  Private
const getPaymentMethods = async (req, res) => {
  try {
    const methods = await PaymentMethod.find({ user: req.user.id });
    res.json(methods);
  } catch (err) {
    console.error('Get payment methods error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update payment method
// @route   PUT /api/users/payment-methods/:id
// @access  Private
const updatePaymentMethod = async (req, res) => {
  const { type, details } = req.body;

  try {
    const method = await PaymentMethod.findById(req.params.id);
    if (!method || method.user.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Payment method not found' });
    }

    method.type = type || method.type;
    method.details = details || method.details;

    await method.save();
    res.json({ message: 'Payment method updated', method });
  } catch (err) {
    console.error('Update payment method error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete payment method
// @route   DELETE /api/users/payment-methods/:id
// @access  Private
const deletePaymentMethod = async (req, res) => {
  try {
    const method = await PaymentMethod.findById(req.params.id);
    if (!method || method.user.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Payment method not found' });
    }

    await method.deleteOne();
    res.json({ message: 'Payment method deleted successfully' });
  } catch (err) {
    console.error('Delete payment method error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Notify upgrade
const notifyUpgrade = async (user, level, amount) => {
  await sendEmail(
    user.email,
    'Level Upgrade Successful',
    `<p>Hi ${user.fullName},</p><p>Your account has been successfully upgraded to level ${level}.</p><p>Upgrade amount: ${amount}</p>`
  );
};

// @desc    Notify withdrawal
const notifyWithdrawal = async (user, amount) => {
  await sendEmail(
    user.email,
    'Withdrawal Request Received',
    `<p>Hello ${user.fullName},</p><p>Your withdrawal request of ${amount} has been received and is pending processing.</p>`
  );
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
};
