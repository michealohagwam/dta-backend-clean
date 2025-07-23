const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');

// Load environment variables
dotenv.config();
console.log('🌍 Environment:', process.env.NODE_ENV);
console.log('📡 Mongo URI:', process.env.MONGODB_URI ? 'Loaded' : 'Missing');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Allowed CORS origins
const allowedOrigins = [
  'https://dailytaskacademy.vercel.app',
  'https://dta-admin.vercel.app',
  'https://dailytaskacademy.netlify.app',
  'http://localhost:3000',
  'http://localhost:3001',
];

// Initialize Socket.IO with CORS
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Attach io to app for access in routes
app.set('io', io);

// Trust proxy (for cookies, rate limiters, etc.)
app.set('trust proxy', 1);

// ✅ Middleware
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
app.use(express.json()); // ✅ Required for parsing JSON bodies from frontend

// Base health route
app.get('/', (req, res) => {
  res.send('✅ DTA Backend is Live!');
});

// MongoDB Connection
console.log('Connecting to MongoDB...');
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// ✅ Routes
app.use('/api/users', require('./routes/user'));     // Main user routes (signup, login, verify, etc.)
app.use('/api/admin', require('./routes/admin'));    // Admin-specific routes
app.use('/api/auth', require('./routes/user'));      // Optional alias to support /api/auth/signup, etc.

// WebSocket Events
io.on('connection', (socket) => {
  console.log('🔌 A user connected');

  socket.on('join-room', (userId) => {
    if (userId) {
      socket.join(userId);
      console.log(`✅ User with ID ${userId} joined their room`);
    } else {
      console.log('⚠️ join-room event received without userId');
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ A user disconnected');
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
