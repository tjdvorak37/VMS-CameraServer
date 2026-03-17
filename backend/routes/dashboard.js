const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /api/dashboard  — summary metrics
router.get('/', authenticate, (req, res) => {
  const db = getDb();

  const totalCameras = db.prepare('SELECT COUNT(*) as c FROM cameras').get().c;
  const onlineCameras = db.prepare("SELECT COUNT(*) as c FROM cameras WHERE status = 'online'").get().c;
  const recordingCameras = db.prepare("SELECT COUNT(*) as c FROM cameras WHERE recording_enabled = 1 AND status = 'online'").get().c;
  const offlineCameras  = totalCameras - onlineCameras;

  const unackEvents = db.prepare('SELECT COUNT(*) as c FROM events WHERE acknowledged = 0').get().c;
  const criticalEvents = db.prepare("SELECT COUNT(*) as c FROM events WHERE severity = 'critical' AND acknowledged = 0").get().c;

  const totalRecordings = db.prepare('SELECT COUNT(*) as c FROM recordings').get().c;
  const storageUsed = db.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM recordings').get().total;

  const recentEvents = db.prepare(
    `SELECT e.*, c.name as camera_name FROM events e
     LEFT JOIN cameras c ON c.id = e.camera_id
     ORDER BY e.created_at DESC LIMIT 10`
  ).all();

  // Recording activity last 7 days
  const recordingActivity = db.prepare(`
    SELECT DATE(start_time) as day, COUNT(*) as count, COALESCE(SUM(file_size), 0) as bytes
    FROM recordings
    WHERE start_time >= DATE('now', '-7 days')
    GROUP BY DATE(start_time)
    ORDER BY day ASC
  `).all();

  return res.json({
    cameras: { total: totalCameras, online: onlineCameras, offline: offlineCameras, recording: recordingCameras },
    events: { unacknowledged: unackEvents, critical: criticalEvents },
    recordings: { total: totalRecordings, storageBytes: storageUsed },
    recentEvents,
    recordingActivity,
  });
});

// GET /api/dashboard/settings
router.get('/settings', authenticate, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM system_settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  return res.json(settings);
});

// PUT /api/dashboard/settings  (admin only)
router.put('/settings', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required' });
  }
  const db = getDb();
  const allowed = ['retention_days', 'max_cameras', 'snapshot_interval', 'email_alerts', 'smtp_host', 'smtp_port'];
  const upsert = db.prepare(
    'INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
  );
  const updateMany = db.transaction(pairs => {
    for (const [k, v] of pairs) {
      if (allowed.includes(k)) upsert.run(k, String(v));
    }
  });
  updateMany(Object.entries(req.body));
  return res.json({ message: 'Settings saved' });
});

module.exports = router;
