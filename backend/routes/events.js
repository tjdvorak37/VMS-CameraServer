const express = require('express');
const router = express.Router();
const { query, body, validationResult } = require('express-validator');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /api/events?cameraId=&type=&severity=&acknowledged=&page=&limit=
router.get(
  '/',
  authenticate,
  [
    query('cameraId').optional().isInt(),
    query('acknowledged').optional().isIn(['0', '1', 'false', 'true']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const db = getDb();
    const { cameraId, type, severity, acknowledged, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = '1=1';
    const params = [];

    if (cameraId)    { where += ' AND e.camera_id = ?'; params.push(cameraId); }
    if (type)        { where += ' AND e.event_type = ?'; params.push(type); }
    if (severity)    { where += ' AND e.severity = ?'; params.push(severity); }
    if (acknowledged !== undefined) {
      where += ' AND e.acknowledged = ?';
      params.push(acknowledged === '1' || acknowledged === 'true' ? 1 : 0);
    }

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM events e WHERE ${where}`
    ).get(...params);

    const events = db.prepare(
      `SELECT e.*, c.name as camera_name, c.location as camera_location
       FROM events e
       LEFT JOIN cameras c ON c.id = e.camera_id
       WHERE ${where}
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, parseInt(limit), offset);

    return res.json({
      events,
      total: countRow.total,
      unacknowledged: db.prepare(
        "SELECT COUNT(*) as c FROM events WHERE acknowledged = 0"
      ).get().c,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  }
);

// POST /api/events  (internal — cameras post events)
router.post(
  '/',
  authenticate,
  [
    body('event_type').trim().notEmpty(),
    body('severity').optional().isIn(['info', 'warning', 'critical']),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const db = getDb();
    const { camera_id, event_type, description, severity = 'info', recording_id, thumbnail_path } = req.body;

    const result = db.prepare(`
      INSERT INTO events (camera_id, event_type, description, severity, recording_id, thumbnail_path)
      VALUES (?,?,?,?,?,?)
    `).run(camera_id || null, event_type, description || null, severity,
           recording_id || null, thumbnail_path || null);

    return res.status(201).json({ id: result.lastInsertRowid });
  }
);

// PUT /api/events/:id/acknowledge
router.put('/:id/acknowledge', authenticate, (req, res) => {
  const db = getDb();
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  db.prepare('UPDATE events SET acknowledged = 1 WHERE id = ?').run(event.id);
  return res.json({ message: 'Event acknowledged' });
});

// PUT /api/events/acknowledge-all
router.put('/acknowledge-all', authenticate, (req, res) => {
  if (req.user.role === 'viewer') {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  const db = getDb();
  db.prepare('UPDATE events SET acknowledged = 1 WHERE acknowledged = 0').run();
  return res.json({ message: 'All events acknowledged' });
});

// DELETE /api/events/:id
router.delete('/:id', authenticate, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'operator') {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  const db = getDb();
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  return res.json({ message: 'Event deleted' });
});

module.exports = router;
