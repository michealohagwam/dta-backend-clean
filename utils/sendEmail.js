const nodemailer = require('nodemailer');

const sendEmail = async (to, subject, html) => {
  try {
    // Create transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Verify transporter works before sending (once, optional)
    transporter.verify((error, success) => {
      if (error) {
        console.error('❌ SMTP Error:', error);
      } else {
        console.log('✅ SMTP Server is ready to send messages');
      }
    });

    const mailOptions = {
      from: `"DailyTask Academy" <${process.env.EMAIL_USER}>`, // ✅ Authenticated sender
      to,
      subject,
      html,
    };

    // Send email and log full response
    const info = await transporter.sendMail(mailOptions);
    console.log('📬 Email sent:', info.response); // Gmail response

    // Optional extra logs for dev
    if (process.env.NODE_ENV === 'development') {
      console.log('📦 Full send info:', info);
      console.log('📧 To:', to);
      console.log('📝 Subject:', subject);
      console.log('📄 HTML Content:', html);
    }

  } catch (error) {
    console.error('❌ Email send error:', error.message);
    console.error(error);
  }
};

module.exports = sendEmail;
