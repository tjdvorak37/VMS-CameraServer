const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { body, query, validationResult } = require('express-validator');
const { getDb } = require('../config/database');
const config = require('../config/config');
const { authenticate, requireRole } = require('../middleware/auth');
const discoveryService = require('../services/discoveryService');
const streamManager = require('../services/streamManager');
const recordingManager = require('../services/recordingManager');

function hasFreshManifest(cameraId) {
  try {
    const m3u8Path = path.join(config.STREAMS_DIR, String(cameraId), 'live.m3u8');
    if (!fs.existsSync(m3u8Path)) return false;
    const stats = fs.statSync(m3u8Path);
    const ageMs = Date.now() - stats.mtimeMs;
    if (stats.size <= 0 || ageMs > 15000) return false;

    const text = fs.readFileSync(m3u8Path, 'utf8');
    return /(?:^|\n)\s*[^#\n]+\.ts(?:\?[^\n]*)?\s*(?:\n|$)/m.test(text);
  } catch (_) {
    return false;
  }
}

function withDerivedStatus(camera) {
  const hasLive = hasFreshManifest(camera.id);
  return {
    ...camera,
    status: hasLive ? 'online' : 'offline',
  };
}

// GET /api/cameras
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  let cameras;

  if (req.user.role === 'admin' || req.user.role === 'operator') {
    cameras = db.prepare(
      `SELECT *, (SELECT file_path FROM recordings WHERE camera_id = cameras.id ORDER BY start_time DESC LIMIT 1) as last_recording
       FROM cameras ORDER BY name ASC`
    ).all().map(withDerivedStatus);
  } else {
    // Viewer: only cameras explicitly permitted
    cameras = db.prepare(
      `SELECT c.*, cp.can_ptz, cp.can_export
       FROM cameras c
       JOIN camera_permissions cp ON cp.camera_id = c.id AND cp.user_id = ? AND cp.can_view = 1
       ORDER BY c.name ASC`
    ).all(req.user.id).map(withDerivedStatus);
  }

  return res.json(cameras);
});

// GET /api/cameras/:id
router.get('/:id', authenticate, (req, res) => {
  try {
    const db = getDb();
    const camera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id);
    if (!camera) return res.status(404).json({ error: 'Camera not found' });

    // Strip credentials for non-admin
    if (req.user.role === 'viewer') {
      delete camera.password;
      delete camera.username;
      delete camera.rtsp_url;
    }

    return res.json(camera);
  } catch (err) {
    console.error('[Cameras] Get camera error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cameras  (admin/operator)
router.post(
  '/',
  authenticate,
  requireRole('admin', 'operator'),
  [
    body('name').trim().notEmpty().withMessage('Camera name is required'),
    body('ip_address').trim().notEmpty().withMessage('IP address is required'),
    body('rtsp_url').trim().notEmpty().withMessage('RTSP URL is required'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const db = getDb();
    const {
      name, ip_address, port = 554, rtsp_url, username, password,
      protocol = 'RTSP', manufacturer, model, location, recording_enabled = 1,
      onvif_port = 80, resolution = '1920x1080', fps = 15, rotation = 0,
    } = req.body;

    const normalizedRotation = [0, 90, 180, 270].includes(Number(rotation))
      ? Number(rotation)
      : 0;

    try {
      const result = db.prepare(`
        INSERT INTO cameras
          (name, ip_address, port, rtsp_url, username, password, protocol,
           manufacturer, model, location, recording_enabled, onvif_port, resolution, fps, rotation)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(name, ip_address, port, rtsp_url, username || null, password || null,
             protocol, manufacturer || null, model || null, location || null,
             recording_enabled ? 1 : 0, onvif_port, resolution, fps, normalizedRotation);

      const camera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(result.lastInsertRowid);

      // Auto-start streaming and recording if enabled
      streamManager.startStream(camera);
      if (camera.recording_enabled) {
        recordingManager.startRecording(camera);
      }

      return res.status(201).json(camera);
    } catch (err) {
      console.error('[Cameras] Create error:', err);
      return res.status(500).json({
        error: 'Internal server error',
        details: err?.message || String(err),
      });
    }
  }
);

// PUT /api/cameras/:id
router.put(
  '/:id',
  authenticate,
  requireRole('admin', 'operator'),
  (req, res) => {
    try {
      const db = getDb();
      const camera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id);
      if (!camera) return res.status(404).json({ error: 'Camera not found' });

      const allowedFields = [
        'name', 'ip_address', 'port', 'rtsp_url', 'username', 'password',
        'protocol', 'manufacturer', 'model', 'location', 'recording_enabled',
        'snapshot_url', 'onvif_port', 'resolution', 'fps', 'rotation',
      ];

      const updates = {};
      allowedFields.forEach(f => {
        if (req.body[f] !== undefined) {
          const v = req.body[f];
          // SQLite cannot bind booleans — convert to 0/1
          updates[f] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
        }
      });

      if (Object.keys(updates).length > 0) {
        if (updates.rotation !== undefined) {
          const normalizedRotation = Number(updates.rotation);
          updates.rotation = [0, 90, 180, 270].includes(normalizedRotation) ? normalizedRotation : 0;
        }

        const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        db.prepare(`UPDATE cameras SET ${sets} WHERE id = ?`).run(...Object.values(updates), camera.id);
      }

      // Restart worker processes when connection/auth/recording settings change.
      const streamRelevantChanged =
        updates.rtsp_url !== undefined ||
        updates.username !== undefined ||
        updates.password !== undefined ||
        updates.port !== undefined;

      const recordingRelevantChanged =
        streamRelevantChanged || updates.recording_enabled !== undefined;

      if (streamRelevantChanged || recordingRelevantChanged) {
        const updatedCamera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(camera.id);
        try {
          if (streamRelevantChanged) {
            streamManager.stopStream(camera.id);
            streamManager.startStream(updatedCamera);
          }

          if (recordingRelevantChanged) {
            recordingManager.stopRecording(camera.id);
            if (updatedCamera.recording_enabled) {
              recordingManager.startRecording(updatedCamera);
            }
          }
        } catch (restartErr) {
          console.error('[Cameras] Non-fatal restart error after update:', restartErr);
        }
      }

      return res.json(db.prepare('SELECT * FROM cameras WHERE id = ?').get(camera.id));
    } catch (err) {
      console.error('[Cameras] Update camera error:', err);
      return res.status(500).json({
        error: 'Internal server error',
        details: err?.message || String(err),
      });
    }
  }
);

// DELETE /api/cameras/:id
router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  const db = getDb();
  const camera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id);
  if (!camera) return res.status(404).json({ error: 'Camera not found' });

  streamManager.stopStream(camera.id);
  recordingManager.stopRecording(camera.id);

  db.prepare('DELETE FROM cameras WHERE id = ?').run(camera.id);
  return res.json({ message: 'Camera deleted' });
});

// POST /api/cameras/discover  — ONVIF network discovery
router.post('/discover', authenticate, requireRole('admin', 'operator'), async (req, res) => {
  try {
    const requestedSubnets = Array.isArray(req.body?.subnets) ? req.body.subnets : [];
    if (requestedSubnets.length > 0) {
      console.log(`[Cameras] Discovery requested for subnets: ${requestedSubnets.join(', ')}`);
    }
    const devices = await discoveryService.discoverCameras({
      subnets: requestedSubnets,
    });
    return res.json({ devices });
  } catch (err) {
    console.error('[Cameras] Discovery error:', err);
    return res.status(500).json({ error: 'Discovery failed', details: err.message });
  }
});

// POST /api/cameras/:id/snapshot
router.post('/:id/snapshot', authenticate, async (req, res) => {
  const db = getDb();
  const camera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id);
  if (!camera) return res.status(404).json({ error: 'Camera not found' });

  try {
    const snapshotPath = await streamManager.captureSnapshot(camera);
    db.prepare('UPDATE cameras SET thumbnail_path = ? WHERE id = ?').run(snapshotPath, camera.id);
    return res.json({ snapshot: snapshotPath });
  } catch (err) {
    return res.status(500).json({ error: 'Snapshot failed', details: err.message });
  }
});

// POST /api/cameras/:id/stream/test
router.post('/:id/stream/test', authenticate, requireRole('admin', 'operator'), async (req, res) => {
  const db = getDb();
  const camera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id);
  if (!camera) return res.status(404).json({ error: 'Camera not found' });

  try {
    const result = await streamManager.testRtspConnection(camera, { timeoutMs: 12000 });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: 'probe_error',
      error: 'RTSP test failed',
      details: err.message,
    });
  }
});

// POST /api/cameras/:id/stream/start
router.post('/:id/stream/start', authenticate, requireRole('admin', 'operator'), (req, res) => {
  const db = getDb();
  const camera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id);
  if (!camera) return res.status(404).json({ error: 'Camera not found' });
  streamManager.startStream(camera);
  return res.json({ message: 'Stream starting' });
});

// POST /api/cameras/:id/stream/stop
router.post('/:id/stream/stop', authenticate, requireRole('admin', 'operator'), (req, res) => {
  streamManager.stopStream(req.params.id);
  return res.json({ message: 'Stream stopped' });
});

// POST /api/cameras/:id/recording/start
router.post('/:id/recording/start', authenticate, requireRole('admin', 'operator'), (req, res) => {
  const db = getDb();
  const camera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id);
  if (!camera) return res.status(404).json({ error: 'Camera not found' });
  recordingManager.startRecording(camera);
  db.prepare('UPDATE cameras SET recording_enabled = 1 WHERE id = ?').run(camera.id);
  return res.json({ message: 'Recording starting' });
});

// POST /api/cameras/:id/recording/stop
router.post('/:id/recording/stop', authenticate, requireRole('admin', 'operator'), (req, res) => {
  const db = getDb();
  recordingManager.stopRecording(req.params.id);
  db.prepare('UPDATE cameras SET recording_enabled = 0 WHERE id = ?').run(req.params.id);
  return res.json({ message: 'Recording stopped' });
});

module.exports = router;
