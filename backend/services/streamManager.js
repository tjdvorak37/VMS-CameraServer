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
const intentionallyStopped = new Set();

function resolveFfmpegBin() {
  const candidates = [
    process.env.FFMPEG_PATH,
    config.FFMPEG_PATH,
  ].filter(Boolean);

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe'
    );
  }

  for (const candidate of candidates) {
    try {
      if (candidate === 'ffmpeg') continue;
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) {}
  }

  return candidates[0] || 'ffmpeg';
}

function clearStreamArtifacts(streamDir) {
  try {
    const files = fs.readdirSync(streamDir);
    files.forEach((file) => {
      if (file.endsWith('.m3u8') || file.endsWith('.ts')) {
        fs.unlinkSync(path.join(streamDir, file));
      }
    });
  } catch (_) {}
}

function isStreamHealthy(cameraId) {
  try {
    const streamDir = path.join(config.STREAMS_DIR, String(cameraId));
    const m3u8Path = path.join(streamDir, 'live.m3u8');
    if (!fs.existsSync(m3u8Path)) return false;

    const stats = fs.statSync(m3u8Path);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs > 12000 || stats.size <= 0) return false;

    const text = fs.readFileSync(m3u8Path, 'utf8');
    return /\.ts(\?|$)/.test(text);
  } catch (_) {
    return false;
  }
}

function getRotationFilter(rotation) {
  const normalized = Number(rotation) || 0;
  if (normalized === 90) return 'transpose=1';
  if (normalized === 180) return 'transpose=1,transpose=1';
  if (normalized === 270) return 'transpose=2';
  return null;
}

/**
 * Build an effective RTSP URL, embedding stored credentials if not already in the URL.
 */
function buildRtspUrl(camera) {
  if (!camera.username && !camera.password) return camera.rtsp_url;
  try {
    const url = new URL(camera.rtsp_url);
    // Always prefer stored camera credentials over any stale credentials in rtsp_url.
    if (camera.username) url.username = camera.username;
    if (camera.password) url.password = camera.password;
    return url.toString();
  } catch (_) {
    return camera.rtsp_url;
  }
}

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
  intentionallyStopped.delete(id);

  if (activeStreams.has(id)) {
    stopStream(id);
  }

  const streamDir = ensureStreamDir(id);
  clearStreamArtifacts(streamDir);
  const m3u8Path = path.join(streamDir, 'live.m3u8');
  const segmentPath = path.join(streamDir, 'seg%d.ts');

  const args = [
    '-rtsp_transport', 'tcp',
    '-i', buildRtspUrl(camera),
  ];

  const rotationFilter = getRotationFilter(camera.rotation);
  if (rotationFilter) {
    args.push('-vf', rotationFilter);
  }

  args.push(
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
    '-hls_flags', 'delete_segments+independent_segments+omit_endlist',
    '-hls_segment_filename', segmentPath,
    '-y',
    m3u8Path,
  );

  const ffmpegBin = resolveFfmpegBin();

  console.log(`[StreamManager] Starting stream for camera ${id} (${camera.name}) using ${ffmpegBin}`);

  const proc = spawn(ffmpegBin, args, {
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

  proc.on('exit', (code, signal) => {
    console.log(`[StreamManager] Stream for camera ${id} exited (code ${code}, signal ${signal || 'none'})`);
    activeStreams.delete(id);

    const wasIntentional = intentionallyStopped.has(id);
    intentionallyStopped.delete(id);

    // Update camera status in DB
    try {
      const db = getDb();
      db.prepare("UPDATE cameras SET status = 'offline', stream_pid = NULL WHERE id = ?").run(id);
    } catch (_) {}

    if (wasIntentional) return;

    // Restart after delay (unless deliberately stopped)
    const shouldRestart = code !== 0 || Boolean(signal);
    if (shouldRestart) {
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
    try {
      const db = getDb();
      db.prepare("UPDATE cameras SET status = 'offline', stream_pid = NULL WHERE id = ?").run(id);
    } catch (_) {}
  });

  activeStreams.set(id, {
    process: proc,
    status: 'starting',
    startedAt: new Date().toISOString(),
    cameraId: id,
    healthCheckTimer: null,
  });

  // Only mark stream healthy once HLS playlist and segments are actually generated.
  const startedAt = Date.now();
  const healthCheckTimer = setInterval(() => {
    const entry = activeStreams.get(id);
    if (!entry || entry.process !== proc) {
      clearInterval(healthCheckTimer);
      return;
    }

    if (isStreamHealthy(id)) {
      entry.status = 'streaming';
      clearInterval(healthCheckTimer);
      try {
        const db = getDb();
        db.prepare(
          "UPDATE cameras SET status = 'online', stream_pid = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(proc.pid, id);
      } catch (_) {}
      return;
    }

    if (Date.now() - startedAt > 20000) {
      clearInterval(healthCheckTimer);
      entry.status = 'error';
      try {
        proc.kill('SIGTERM');
      } catch (_) {}
    }
  }, 1000);

  activeStreams.get(id).healthCheckTimer = healthCheckTimer;
}

/**
 * Stop the stream for a camera.
 */
function stopStream(cameraId) {
  const id = parseInt(cameraId);
  const entry = activeStreams.get(id);
  if (entry && entry.process) {
    intentionallyStopped.add(id);
    if (entry.healthCheckTimer) {
      clearInterval(entry.healthCheckTimer);
    }
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
      '-i', buildRtspUrl(camera),
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
