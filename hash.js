const bcrypt = require('bcryptjs');

bcrypt.hash("12345678", 10).then(hash => {
  console.log("Hashed password:", hash);
});
