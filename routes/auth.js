const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const Referral = require('../models/Referral');
const EmailLog = require('../models/EmailLog');
const router = express.Router();

const transporter = require('../config/nodemailer');
// Use transporter for email sending

// Configure Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});


// Generate random verification code
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate referral code
const generateReferralCode = () => {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
};

// Sign-Up Route
router.post('/signup', async (req, res) => {
  const { name: fullName, username, email, phone, password, referralCode, level, amount } = req.body;

  try {
    // Check if user already exists
    let user = await User.findOne({ $or: [{ email }, { username }] });
    if (user) {
      return res.status(400).json({ message: 'Email or username already exists' });
    }

    // Validate referral code
    let referrer = null;
    if (referralCode) {
      referrer = await User.findOne({ referralCode });
      if (!referrer) {
        return res.status(400).json({ message: 'Invalid referral code' });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate verification code and referral code
    const verificationCode = generateVerificationCode();
    const newReferralCode = generateReferralCode();

    // Create user
    user = new User({
      fullName,
      username,
      email,
      phone,
      password: hashedPassword,
      referralCode: newReferralCode,
      level,
      verificationCode,
    });

    await user.save();

    // Create referral record if referral code was provided
    if (referrer) {
      const referral = new Referral({
        referrer: referrer._id,
        referred: user._id,
      });
      await referral.save();
      referrer.referrals.push(referral._id);
      referrer.invites += 1;
      await referrer.save();
    }

    // Send verification email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'DTA Email Verification',
      text: `Your verification code is: ${verificationCode}`,
      html: `<p>Your verification code is: <b>${verificationCode}</b></p><p>Or click <a href="http://localhost:5000/api/auth/verify-email/${verificationCode}">here</a> to verify your email.</p>`,
    };

    await transporter.sendMail(mailOptions);
    await EmailLog.create({ type: 'verification', recipient: email });

    res.status(201).json({ message: `User registered. Please verify your email and pay ₦${amount.toLocaleString()} for Level ${level}.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Email Verification Route
router.get('/verify-email/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const user = await User.findOne({ verificationCode: token });
    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    user.status = 'verified';
    user.verificationCode = null;
    await user.save();

    res.status(200).json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login Route
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (user.status !== 'verified' && user.status !== 'active') {
      return res.status(400).json({ message: 'Please verify your email or activate your account' });
    }

    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, process.env.JWT_SECRET, {
      expiresIn: '1d',
    });

    res.status(200).json({ token, message: 'Login successful' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Forgot Password Route
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    const resetCode = generateVerificationCode();
    user.verificationCode = resetCode;
    await user.save();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'DTA Password Reset',
      text: `Your password reset code is: ${resetCode}`,
      html: `<p>Your password reset code is: <b>${resetCode}</b></p><p>Or click <a href="http://localhost:5000/reset-password.html?token=${resetCode}">here</a> to reset your password.</p>`,
    };

    await transporter.sendMail(mailOptions);
    await EmailLog.create({ type: 'reset-password', recipient: email });

    res.status(200).json({ message: 'Password reset code sent to email' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reset Password Route
router.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  try {
    const user = await User.findOne({ verificationCode: token });
    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset code' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.verificationCode = null;
    await user.save();

    await EmailLog.create({ type: 'reset-password', recipient: user.email });
    res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;