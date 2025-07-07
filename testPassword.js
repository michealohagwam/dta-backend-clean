const bcrypt = require('bcryptjs');

const inputPassword = '123456';
const hashedPassword = '$2a$10$G2AkDqce4GwiSRKzkQeL.u43fDAbNcumzNK4M.pi.dKK2C2K5cCwi';

bcrypt.compare(inputPassword, hashedPassword).then(isMatch => {
  console.log('Match:', isMatch);
});
