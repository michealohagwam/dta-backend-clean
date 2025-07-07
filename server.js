const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');

// Load environment variables
dotenv.config();

// Initialize app and server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*', // Change to your frontend domain in production
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
console.log('Connecting to MongoDB URI:', process.env.MONGODB_URI);
mongoose.connect(process.env.MONGODB_URI).then(() => {
  console.log('✅ MongoDB Connected');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// Routes
app.use('/api/users', require('./routes/user'));
app.use('/api/tasks', require('./routes/task'));
app.use('/api/withdrawals', require('./routes/withdrawal'));
app.use('/api/referrals', require('./routes/referral'));
app.use('/api/admin', require('./routes/admin'));


// Make io accessible in routes
app.set('io', io);

// WebSocket Events
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));