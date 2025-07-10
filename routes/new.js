const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { authMiddleware } = require('../middleware/auth');
const User = require('../models/User');
const Referral = require('../models/Referral');
const EmailLog = require('../models/EmailLog');
const PaymentMethod = require('../models/PaymentMethod');
const Withdrawal = require('../models/Withdrawal');
const Upgrade = require('../models/Upgrade');
const sendEmail = require('../utils/sendEmail');

const router = express.Router();

const transporter = require('../config/nodemailer');

// Nodemailer setup
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const generateVerificationCode = () => Math.floor(100000 + Math.random() * 900000).toString();
const generateReferralCode = () => Math.random().toString(36).substring(2, 10).toUpperCase();

// Signup rate limiter
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many signup attempts from this IP, please try again later.'
});

// User Signup
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

    let referrer = null;
    if (referralCode) {
      referrer = await User.findOne({ referralCode });
      if (!referrer) return res.status(400).json({ message: 'Invalid referral code' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationCode = generateVerificationCode();
    const newReferralCode = generateReferralCode();
    const signupIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const user = new User({
      fullName: name,
      username,
      email,
      contact: phone,
      password: hashedPassword,
      referredBy: referralCode || null,
      referralCode: newReferralCode,
      level,
      status: 'pending',
      verificationCode,
      balance: { available: 0, pending: 0 },
      profileSet: false,
      tasksCompleted: 0,
      signupIP
    });

    await user.save();

    if (referrer) {
      const referral = new Referral({ referrer: referrer._id, referred: user._id });
      await referral.save();
      referrer.referrals.push(referral._id);
      referrer.invites += 1;
      await referrer.save();
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'DTA Email Verification',
      html: `<p>Your verification code is: <b>${verificationCode}</b></p>`
    };

    await transporter.sendMail(mailOptions);
    await EmailLog.create({ type: 'verification', recipient: email });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: `User registered. Please verify your email and pay ₦${amount} for Level ${level}.`,
      token
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    if (user.status !== 'verified' && user.status !== 'active') {
      return res.status(400).json({ message: 'Please verify your email or activate your account' });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.status(200).json({ token, message: 'Login successful' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Forgot password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'User not found' });

    const code = generateVerificationCode();
    user.verificationCode = code;
    await user.save();

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'DTA Password Reset',
      html: `<p>Your password reset code is: <b>${code}</b></p>`
    });
    await EmailLog.create({ type: 'reset-password', recipient: email });

    res.json({ message: 'Password reset code sent to email' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reset password
router.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;
  try {
    const user = await User.findOne({ verificationCode: token });
    if (!user) return res.status(400).json({ message: 'Invalid or expired reset code' });

    user.password = await bcrypt.hash(password, 10);
    user.verificationCode = null;
    await user.save();

    await EmailLog.create({ type: 'reset-password', recipient: user.email });
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -verificationCode');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});



module.exports = router;
