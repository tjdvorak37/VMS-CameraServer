require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getDb } = require('../config/database');

const username = process.env.ADMIN_USERNAME || 'admin';
const newPassword = (process.env.NEW_ADMIN_PASSWORD || '').trim();

if (!newPassword) {
  console.error('[ResetAdminPassword] NEW_ADMIN_PASSWORD is required.');
  process.exit(1);
}

if (newPassword.length < 8) {
  console.error('[ResetAdminPassword] NEW_ADMIN_PASSWORD must be at least 8 characters.');
  process.exit(1);
}

async function main() {
  const db = getDb();
  const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);

  if (!user) {
    console.error(`[ResetAdminPassword] User not found: ${username}`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(newPassword, 12);

  db.prepare(
    'UPDATE users SET password_hash = ?, must_change_password = 0, is_active = 1 WHERE id = ?'
  ).run(hash, user.id);

  console.log(`[ResetAdminPassword] Password reset for user ${user.username}.`);
}

main().catch((err) => {
  console.error('[ResetAdminPassword] Failed:', err.message);
  process.exit(1);
});
