// Seed script — creates an admin user
// Usage: node db/seed.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./database');
const { initDatabase } = require('./database');

async function seed() {
  await initDatabase();

  const email = process.env.ADMIN_EMAIL || 'admin@palapizza.co.uk';
  const password = process.env.ADMIN_PASSWORD || 'changeme123';

  const hash = await bcrypt.hash(password, 12);
  const existing = await db.get('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    await db.run('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, email]);
    console.log(`Admin user password updated: ${email}`);
  } else {
    await db.run('INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)', [email, hash, 'Admin']);
    console.log(`Admin user created: ${email}`);
  }

  console.log('Seed complete');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
