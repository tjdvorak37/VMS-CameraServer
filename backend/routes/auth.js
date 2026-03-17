const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { getDb } = require('../config/database');
const config = require('../config/config');
const { authenticate } = require('../middleware/auth');

// POST /api/auth/login
router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;
    const db = getDb();

    try {
      const user = db.prepare(
        'SELECT * FROM users WHERE (username = ? OR email = ?) AND is_active = 1'
      ).get(username, username);

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Update last login
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

      const token = jwt.sign(
        { userId: user.id, role: user.role },
        config.JWT_SECRET,
        { expiresIn: config.JWT_EXPIRES_IN }
      );

      return res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      });
    } catch (err) {
      console.error('[Auth] Login error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

// POST /api/auth/change-password
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    const db = getDb();

    try {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      const newHash = await bcrypt.hash(newPassword, 12);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);

      return res.json({ message: 'Password changed successfully' });
    } catch (err) {
      console.error('[Auth] Change password error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
