const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');

// Load environment variables
dotenv.config();

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS settings
const io = socketIo(server, {
  cors: {
    origin: [
      'https://dta-client.vercel.app',
      'https://dta-admin.vercel.app',
      'http://localhost:3000',
      'http://localhost:3001'
    ],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: [
    'https://dta-client.vercel.app',
    'https://dta-admin.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());

// MongoDB Connection
console.log('Connecting to MongoDB...');
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ MongoDB Connected');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

// Routes
app.use('/api/users', require('./routes/user'));
app.use('/api/tasks', require('./routes/task'));
app.use('/api/withdrawals', require('./routes/withdrawal'));
app.use('/api/referrals', require('./routes/referral'));
app.use('/api/admin', require('./routes/admin'));

// Make Socket.IO accessible in routes
app.set('io', io);

// WebSocket Events
io.on('connection', (socket) => {
  console.log('🔌 A user connected');

  socket.on('disconnect', () => {
    console.log('❌ A user disconnected');
  });

  // You can define custom events here as needed:
  // socket.on('some-event', (data) => { ... });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
