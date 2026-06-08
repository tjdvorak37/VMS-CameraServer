const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const config = require('../config/config');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const streamManager = require('../services/streamManager');

// Avoid rapid restart thrashing when many clients request a missing stream.
const restartAttemptAt = new Map();
const RESTART_COOLDOWN_MS = 5000;

// GET /api/streams/:cameraId/live.m3u8  (HLS manifest for live view)
router.get('/:cameraId/live.m3u8', authenticate, (req, res) => {
  const cameraId = req.params.cameraId;
  const streamDir = path.join(config.STREAMS_DIR, String(cameraId));
  const m3u8Path = path.join(streamDir, 'live.m3u8');

  if (!fs.existsSync(m3u8Path)) {
    // Self-heal: if playlist is missing, try to (re)start this camera stream.
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

      // Start if inactive, or re-start if not healthy and cooldown elapsed.
      const shouldAttemptRestart = !status || status.status !== 'streaming';
      if (shouldAttemptRestart && (now - lastAttempt) >= RESTART_COOLDOWN_MS) {
        try {
          streamManager.stopStream(cameraId);
        } catch (_) {}
        streamManager.startStream(camera);
        restartAttemptAt.set(String(cameraId), now);
      }
    } catch (err) {
      console.error(`[Streams] Failed to auto-start stream for camera ${cameraId}:`, err.message);
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
