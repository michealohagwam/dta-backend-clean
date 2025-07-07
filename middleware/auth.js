const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided or malformed' });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = { id: user._id.toString(), isAdmin: user.isAdmin };
    req.userDoc = user;

    next();
  } catch (error) {
    console.error('JWT Error:', error.message);
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (!req.userDoc?.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

module.exports = { authMiddleware, adminMiddleware };
// This middleware checks for a valid JWT token in the Authorization header.