const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { query, validationResult } = require('express-validator');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const config = require('../config/config');

// GET /api/recordings?cameraId=&start=&end=&page=&limit=
router.get(
  '/',
  authenticate,
  [
    query('cameraId').optional().isInt(),
    query('start').optional().isISO8601(),
    query('end').optional().isISO8601(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const db = getDb();
    const { cameraId, start, end, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = '1=1';
    const params = [];

    if (cameraId) { whereClause += ' AND r.camera_id = ?'; params.push(cameraId); }
    if (start)    { whereClause += ' AND r.start_time >= ?'; params.push(start); }
    if (end)      { whereClause += ' AND r.start_time <= ?'; params.push(end); }

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM recordings r WHERE ${whereClause}`
    ).get(...params);

    const recordings = db.prepare(
      `SELECT r.*, c.name as camera_name, c.location as camera_location
       FROM recordings r
       JOIN cameras c ON c.id = r.camera_id
       WHERE ${whereClause}
       ORDER BY r.start_time DESC
       LIMIT ? OFFSET ?`
    ).all(...params, parseInt(limit), offset);

    return res.json({
      recordings,
      total: countRow.total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(countRow.total / parseInt(limit)),
    });
  }
);

// GET /api/recordings/:id  (metadata)
router.get('/:id', authenticate, (req, res) => {
  const db = getDb();
  const recording = db.prepare(
    `SELECT r.*, c.name as camera_name FROM recordings r
     JOIN cameras c ON c.id = r.camera_id WHERE r.id = ?`
  ).get(req.params.id);

  if (!recording) return res.status(404).json({ error: 'Recording not found' });
  return res.json(recording);
});

// GET /api/recordings/:id/play  (serve video file)
router.get('/:id/play', authenticate, (req, res) => {
  const db = getDb();
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });

  const filePath = recording.file_path;
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Recording file not found on disk' });
  }

  // Security: ensure path is within recordings dir
  const resolvedPath = path.resolve(filePath);
  const resolvedRecDir = path.resolve(config.RECORDINGS_DIR);
  if (!resolvedPath.startsWith(resolvedRecDir)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Range requests for video scrubbing
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const fileStream = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });
    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// DELETE /api/recordings/:id
router.delete('/:id', authenticate, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'operator') {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const db = getDb();
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });

  // Delete file from disk
  if (recording.file_path && fs.existsSync(recording.file_path)) {
    fs.unlinkSync(recording.file_path);
  }

  db.prepare('DELETE FROM recordings WHERE id = ?').run(recording.id);
  return res.json({ message: 'Recording deleted' });
});

// GET /api/recordings/timeline/:cameraId?start=&end=  (timeline segments)
router.get('/timeline/:cameraId', authenticate, (req, res) => {
  const db = getDb();
  const { start, end } = req.query;

  let where = 'camera_id = ?';
  const params = [req.params.cameraId];

  if (start) { where += ' AND start_time >= ?'; params.push(start); }
  if (end)   { where += ' AND start_time <= ?'; params.push(end); }

  const segments = db.prepare(
    `SELECT id, start_time, end_time, duration, file_size
     FROM recordings WHERE ${where} ORDER BY start_time ASC`
  ).all(...params);

  return res.json(segments);
});

module.exports = router;
