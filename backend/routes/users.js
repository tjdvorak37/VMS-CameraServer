const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { getDb } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/users  (admin only)
router.get('/', authenticate, requireRole('admin'), (req, res) => {
  const db = getDb();
  const users = db.prepare(
    'SELECT id, username, email, role, is_active, created_at, last_login FROM users ORDER BY created_at DESC'
  ).all();
  return res.json(users);
});

// POST /api/users  (admin only)
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [
    body('username').trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('role').isIn(['admin', 'operator', 'viewer']).withMessage('Role must be admin, operator, or viewer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password, role } = req.body;
    const db = getDb();

    try {
      const existing = db.prepare(
        'SELECT id FROM users WHERE username = ? OR email = ?'
      ).get(username, email);
      if (existing) {
        return res.status(409).json({ error: 'Username or email already exists' });
      }

      const hash = await bcrypt.hash(password, 12);
      const result = db.prepare(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
      ).run(username, email, hash, role);

      const user = db.prepare(
        'SELECT id, username, email, role, is_active, created_at FROM users WHERE id = ?'
      ).get(result.lastInsertRowid);

      return res.status(201).json(user);
    } catch (err) {
      console.error('[Users] Create error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// PUT /api/users/:id  (admin only)
router.put(
  '/:id',
  authenticate,
  requireRole('admin'),
  [
    body('email').optional().isEmail().normalizeEmail(),
    body('role').optional().isIn(['admin', 'operator', 'viewer']),
    body('is_active').optional().isBoolean(),
    body('password').optional().isLength({ min: 8 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent removing the last admin
    if (req.body.role && req.body.role !== 'admin' && user.role === 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get();
      if (adminCount.count <= 1) {
        return res.status(400).json({ error: 'Cannot demote the last admin account' });
      }
    }

    try {
      const updates = {};
      if (req.body.email !== undefined) updates.email = req.body.email;
      if (req.body.role !== undefined) updates.role = req.body.role;
      if (req.body.is_active !== undefined) updates.is_active = req.body.is_active ? 1 : 0;

      if (req.body.password) {
        updates.password_hash = await bcrypt.hash(req.body.password, 12);
      }

      if (Object.keys(updates).length > 0) {
        const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...Object.values(updates), user.id);
      }

      const updated = db.prepare(
        'SELECT id, username, email, role, is_active, created_at, last_login FROM users WHERE id = ?'
      ).get(user.id);

      return res.json(updated);
    } catch (err) {
      console.error('[Users] Update error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /api/users/:id  (admin only)
router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  const db = getDb();

  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get();
  if (user.role === 'admin' && adminCount.count <= 1) {
    return res.status(400).json({ error: 'Cannot delete the last admin account' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  return res.json({ message: 'User deleted successfully' });
});

module.exports = router;
