// test-email.js
require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.verify((error, success) => {
  if (error) {
    console.error('Nodemailer verification error:', error);
  } else {
    console.log('Nodemailer is ready to send emails');
  }
});

const mailOptions = {
  from: process.env.EMAIL_USER,
  to: 'allezyyoung@gmail.com', // Replace with a valid email (e.g., your own)
  subject: 'Test Email',
  text: 'This is a test email from Nodemailer',
};

transporter.sendMail(mailOptions).then(() => {
  console.log('Test email sent');
}).catch(err => {
  console.error('Test email error:', err);
});