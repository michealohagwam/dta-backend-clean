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
  'https://dta-client.vercel.app',
  'https://dta-admin.vercel.app',
  'https://dailytaskacademy.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001'
];

// Initialize Socket.IO with CORS
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Attach io to app for use in routes
app.set('io', io);

// Middleware
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
app.use(express.json());

// Base route
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

// Routes
app.use('/api/users', require('./routes/user'));
app.use('/api/tasks', require('./routes/task'));
app.use('/api/withdrawals', require('./routes/withdrawal'));
app.use('/api/referrals', require('./routes/referral'));
app.use('/api/admin', require('./routes/admin'));

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
