const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: 587, // ✅ use 465 instead of 587
  secure: false, // ✅ true for port 465 (SSL)
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // should be your Gmail App Password
  },
});

module.exports = transporter;
