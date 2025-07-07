// run this in Node
//const bcrypt = require('bcryptjs');
//bcrypt.hash('123456', 10).then(console.log);


//const bcrypt = require('bcryptjs');
//bcrypt.compare('123456', '$2a$10$DHVA8ybIakPD8ib1whzprO0BxLJcDVcwEsFoC88akT2y1hIE9DDcm')
//  .then(console.log); // should log true


//const bcrypt = require('bcryptjs');
//bcrypt.hash('123456', 10).then(hash => console.log(hash));

const bcrypt = require('bcryptjs');

bcrypt.hash('123456', 10).then(hash => {
  console.log('Hashed password:', hash);
}).catch(err => {
  console.error('Error hashing password:', err);
});


//const bcrypt = require('bcryptjs');
//const hash = "$2a$10$G2AkDqce4GwiSRKzkQeL.u43fDAbNcumzNK4M.pi.dKK2C2K5cCwi";
//const input = "123456";
//bcrypt.compare(input, hash).then(console.log); // should print `true`
