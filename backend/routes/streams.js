const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const config = require('../config/config');
const { getDb } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const streamManager = require('../services/streamManager');

// Avoid rapid restart thrashing when many clients request a missing stream.
const restartAttemptAt = new Map();
const RESTART_COOLDOWN_MS = 5000;

function hasFreshManifest(m3u8Path) {
  try {
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

function hasAnyManifest(m3u8Path) {
  try {
    if (!fs.existsSync(m3u8Path)) return false;
    const stats = fs.statSync(m3u8Path);
    if (stats.size <= 0) return false;
    const text = fs.readFileSync(m3u8Path, 'utf8');
    return /(?:^|\n)\s*[^#\n]+\.ts(?:\?[^\n]*)?\s*(?:\n|$)/m.test(text);
  } catch (_) {
    return false;
  }
}

// POST /api/streams/reconnect-all
router.post('/reconnect-all', authenticate, requireRole('admin', 'operator'), (req, res) => {
  try {
    const db = getDb();
    const cameras = db.prepare('SELECT * FROM cameras ORDER BY id ASC').all();

    if (cameras.length === 0) {
      return res.json({
        message: 'No cameras available to reconnect',
        restarted: 0,
      });
    }

    cameras.forEach((camera, index) => {
      setTimeout(() => {
        try {
          streamManager.stopStream(camera.id);
        } catch (_) {}
        streamManager.startStream(camera);
      }, index * 400);
    });

    return res.json({
      message: 'Live view recovery started',
      restarted: cameras.length,
    });
  } catch (err) {
    console.error('[Streams] Reconnect-all error:', err);
    return res.status(500).json({ error: 'Failed to start stream recovery' });
  }
});

// POST /api/streams/:cameraId/reconnect
router.post('/:cameraId/reconnect', authenticate, requireRole('admin', 'operator'), (req, res) => {
  const cameraId = req.params.cameraId;

  try {
    const db = getDb();
    const camera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(cameraId);
    if (!camera) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    try {
      streamManager.stopStream(cameraId);
    } catch (_) {}
    streamManager.startStream(camera);

    return res.json({
      message: `Reconnect started for ${camera.name}`,
      cameraId: camera.id,
    });
  } catch (err) {
    console.error(`[Streams] Reconnect error for camera ${cameraId}:`, err);
    return res.status(500).json({ error: 'Failed to reconnect stream' });
  }
});

// GET /api/streams/:cameraId/live.m3u8  (HLS manifest for live view)
router.get('/:cameraId/live.m3u8', authenticate, (req, res) => {
  const cameraId = req.params.cameraId;
  const streamDir = path.join(config.STREAMS_DIR, String(cameraId));
  const m3u8Path = path.join(streamDir, 'live.m3u8');

  const hasFresh = hasFreshManifest(m3u8Path);
  const hasAny = hasAnyManifest(m3u8Path);

  if (!hasFresh) {
    // Self-heal: if the playlist is missing and no stream is active, start one.
    // Do not stop an already-running stream here; it may still be warming up.
    try {
      const statuses = streamManager.getAllStreamStatuses();
      const status = statuses[String(cameraId)];
      const now = Date.now();
      const lastAttempt = restartAttemptAt.get(String(cameraId)) || 0;

      const db = getDb();
      const camera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(cameraId);
      if (!camera) {
        return res.status(404).json({ error: 'Camera not found' });
      }

      const shouldAttemptStart = !status;
      const shouldAttemptRecovery =
        status?.status === 'error' &&
        (now - lastAttempt) >= RESTART_COOLDOWN_MS;

      if (shouldAttemptStart || shouldAttemptRecovery) {
        if (shouldAttemptRecovery && status) {
          try {
            streamManager.stopStream(cameraId);
          } catch (_) {}
        }
        streamManager.startStream(camera);
        restartAttemptAt.set(String(cameraId), now);
      }
    } catch (err) {
      console.error(`[Streams] Failed to auto-start stream for camera ${cameraId}:`, err.message);
    }

    // If a stale manifest still exists, serve it while recovery runs in background
    // so the player can keep retrying instead of immediately hard-failing.
    if (hasAny) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Stream-Stale', '1');
      return res.sendFile(m3u8Path);
    }

    return res.status(503).json({ error: 'Stream warming up. Retrying...' });
  }

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(m3u8Path);
});

// GET /api/streams/:cameraId/:segment  (HLS .ts segment file)
router.get('/:cameraId/:segment', authenticate, (req, res) => {
  const cameraId = req.params.cameraId;
  const segment = req.params.segment;

  // Security: only allow .ts or .m3u8 files, no path traversal
  if (!/^[\w\-]+\.(ts|m3u8)$/.test(segment)) {
    return res.status(400).json({ error: 'Invalid segment name' });
  }

  const segmentPath = path.join(config.STREAMS_DIR, String(cameraId), segment);
  if (!fs.existsSync(segmentPath)) {
    return res.status(404).json({ error: 'Segment not found' });
  }

  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(segmentPath);
});

// GET /api/streams/status  (all active streams)
router.get('/status', authenticate, (req, res) => {
  const statuses = streamManager.getAllStreamStatuses();
  return res.json(statuses);
});

module.exports = router;
