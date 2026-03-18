/**
 * Stream Manager Service
 * Manages live HLS streams for cameras using FFmpeg.
 * Each camera gets a continuous HLS stream written to its stream directory.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');
const { getDb } = require('../config/database');

// Map of cameraId -> { process, status, startedAt }
const activeStreams = new Map();

/**
 * Ensure the stream directory exists for a camera.
 */
function ensureStreamDir(cameraId) {
  const dir = path.join(config.STREAMS_DIR, String(cameraId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Start an HLS stream for a camera.
 */
function startStream(camera) {
  const id = camera.id;
  if (activeStreams.has(id)) {
    stopStream(id);
  }

  const streamDir = ensureStreamDir(id);
  const m3u8Path = path.join(streamDir, 'live.m3u8');
  const segmentPath = path.join(streamDir, 'seg%d.ts');

  const args = [
    '-rtsp_transport', 'tcp',
    '-i', camera.rtsp_url,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-g', '30',
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-ar', '44100',
    '-b:a', '96k',
    '-f', 'hls',
    '-hls_time', String(config.HLS_TIME),
    '-hls_list_size', String(config.HLS_LIST_SIZE),
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', segmentPath,
    '-y',
    m3u8Path,
  ];

  console.log(`[StreamManager] Starting stream for camera ${id} (${camera.name})`);

  const proc = spawn('ffmpeg', args, {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const recentFfmpegLines = [];
  proc.stderr.on('data', (data) => {
    const lines = data.toString().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    lines.forEach(line => {
      recentFfmpegLines.push(line);
      if (recentFfmpegLines.length > 25) recentFfmpegLines.shift();
    });
  });

  proc.on('exit', (code) => {
    console.log(`[StreamManager] Stream for camera ${id} exited (code ${code})`);
    activeStreams.delete(id);

    // Update camera status in DB
    try {
      const db = getDb();
      db.prepare("UPDATE cameras SET status = 'offline', stream_pid = NULL WHERE id = ?").run(id);
    } catch (_) {}

    // Restart after delay (unless deliberately stopped)
    if (code !== null && code !== 0) {
      if (recentFfmpegLines.length > 0) {
        const tail = recentFfmpegLines.slice(-8).join('\n');
        console.error(`[StreamManager] Last FFmpeg output for camera ${id}:\n${tail}`);
      }

      const restartDelay = 5000;
      setTimeout(() => {
        try {
          const db = getDb();
          const cam = db.prepare('SELECT * FROM cameras WHERE id = ?').get(id);
          if (cam) startStream(cam);
        } catch (_) {}
      }, restartDelay);
    }
  });

  proc.on('error', (err) => {
    console.error(`[StreamManager] FFmpeg error for camera ${id}:`, err.message);
    activeStreams.delete(id);
  });

  activeStreams.set(id, {
    process: proc,
    status: 'starting',
    startedAt: new Date().toISOString(),
    cameraId: id,
  });

  // Update DB with PID and online status after a short delay
  setTimeout(() => {
    if (activeStreams.has(id)) {
      activeStreams.get(id).status = 'streaming';
      try {
        const db = getDb();
        db.prepare(
          "UPDATE cameras SET status = 'online', stream_pid = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(proc.pid, id);
      } catch (_) {}
    }
  }, 3000);
}

/**
 * Stop the stream for a camera.
 */
function stopStream(cameraId) {
  const id = parseInt(cameraId);
  const entry = activeStreams.get(id);
  if (entry && entry.process) {
    try {
      entry.process.kill('SIGTERM');
    } catch (_) {}
    activeStreams.delete(id);
  }

  try {
    const db = getDb();
    db.prepare("UPDATE cameras SET status = 'offline', stream_pid = NULL WHERE id = ?").run(id);
  } catch (_) {}
}

/**
 * Capture a snapshot from an RTSP camera.
 */
function captureSnapshot(camera) {
  return new Promise((resolve, reject) => {
    const snapshotDir = path.join(config.SNAPSHOTS_DIR, String(camera.id));
    if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });

    const snapshotFile = path.join(snapshotDir, `snap_${Date.now()}.jpg`);

    const args = [
      '-rtsp_transport', 'tcp',
      '-i', camera.rtsp_url,
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      snapshotFile,
    ];

    const proc = spawn('ffmpeg', args, { stdio: 'ignore' });
    proc.on('exit', (code) => {
      if (code === 0 && fs.existsSync(snapshotFile)) {
        resolve(snapshotFile);
      } else {
        reject(new Error('Snapshot capture failed'));
      }
    });
    proc.on('error', reject);

    // Timeout
    setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      reject(new Error('Snapshot timeout'));
    }, 10000);
  });
}

/**
 * Return status of all active streams.
 */
function getAllStreamStatuses() {
  const result = {};
  activeStreams.forEach((entry, id) => {
    result[id] = {
      status: entry.status,
      startedAt: entry.startedAt,
      pid: entry.process ? entry.process.pid : null,
    };
  });
  return result;
}

/**
 * Boot all enabled cameras' streams on startup.
 */
function initializeStreams() {
  try {
    const db = getDb();
    const cameras = db.prepare('SELECT * FROM cameras').all();
    console.log(`[StreamManager] Initializing streams for ${cameras.length} camera(s)...`);
    cameras.forEach(cam => {
      setTimeout(() => startStream(cam), 500);
    });
  } catch (err) {
    console.error('[StreamManager] Init error:', err);
  }
}

module.exports = {
  startStream,
  stopStream,
  captureSnapshot,
  getAllStreamStatuses,
  initializeStreams,
};
