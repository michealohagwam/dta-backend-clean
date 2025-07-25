// utils/sendEmail.js
const nodemailer = require('nodemailer');

const sendEmail = async (to, subject, html) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Optional: verify connection (can be removed in production)
    transporter.verify((error, success) => {
      if (error) {
        console.error('❌ SMTP Error:', error);
      } else {
        console.log('✅ SMTP server ready');
      }
    });

    const mailOptions = {
      from: `"DailyTask Academy" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('📬 Email sent:', info.response);

    if (process.env.NODE_ENV === 'development') {
      console.log('📦 Full send info:', info);
    }

  } catch (error) {
    console.error('❌ Email send error:', error.message);
    throw error;
  }
};

module.exports = sendEmail;
