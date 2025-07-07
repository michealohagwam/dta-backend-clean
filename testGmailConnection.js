const net = require('net');

const options = {
  host: 'smtp.gmail.com',
  port: 587 // or 465
};

const socket = net.createConnection(options, () => {
  console.log(`✅ Successfully connected to ${options.host}:${options.port}`);
  socket.end();
});

socket.on('error', (err) => {
  console.error(`❌ Failed to connect: ${err.message}`);
});
