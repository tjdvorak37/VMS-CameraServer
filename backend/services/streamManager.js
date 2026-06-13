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
const pendingRestartTimers = new Map();
const restartBackoffMs = new Map();
const STREAM_MONITOR_INTERVAL_MS = 5000;
const STREAM_STALE_AFTER_MS = Number(process.env.STREAM_STALE_AFTER_MS) > 0
  ? Number(process.env.STREAM_STALE_AFTER_MS)
  : 60000;
const STREAM_STARTUP_TIMEOUT_MS = Number(process.env.STREAM_STARTUP_TIMEOUT_MS) > 0
  ? Number(process.env.STREAM_STARTUP_TIMEOUT_MS)
  : 120000;
const STREAM_PLAYLIST_FRESH_MS = Number(process.env.STREAM_PLAYLIST_FRESH_MS) > 0
  ? Number(process.env.STREAM_PLAYLIST_FRESH_MS)
  : 30000;
const MIN_RESTART_DELAY_MS = 3000;
const MAX_RESTART_DELAY_MS = 30000;

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

function clearPendingRestart(cameraId) {
  const timer = pendingRestartTimers.get(cameraId);
  if (timer) {
    clearTimeout(timer);
    pendingRestartTimers.delete(cameraId);
  }
}

function scheduleRestart(cameraId, reason) {
  clearPendingRestart(cameraId);

  const currentBackoff = restartBackoffMs.get(cameraId) || MIN_RESTART_DELAY_MS;
  const delayMs = Math.min(currentBackoff, MAX_RESTART_DELAY_MS);
  restartBackoffMs.set(cameraId, Math.min(delayMs * 2, MAX_RESTART_DELAY_MS));

  console.warn(`[StreamManager] Scheduling restart for camera ${cameraId} in ${delayMs}ms (${reason}).`);

  const timer = setTimeout(() => {
    pendingRestartTimers.delete(cameraId);
    try {
      const db = getDb();
      const cam = db.prepare('SELECT * FROM cameras WHERE id = ?').get(cameraId);
      if (cam) startStream(cam);
    } catch (_) {}
  }, delayMs);

  pendingRestartTimers.set(cameraId, timer);
}

function isStreamHealthy(cameraId) {
  try {
    const streamDir = path.join(config.STREAMS_DIR, String(cameraId));
    const m3u8Path = path.join(streamDir, 'live.m3u8');
    if (!fs.existsSync(m3u8Path)) return false;

    const stats = fs.statSync(m3u8Path);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs > STREAM_PLAYLIST_FRESH_MS || stats.size <= 0) return false;

    const text = fs.readFileSync(m3u8Path, 'utf8');

    // HLS playlists are multi-line; segment entries are usually followed by a newline,
    // not end-of-string. Treat any non-comment .ts entry as healthy content.
    return /(?:^|\n)\s*[^#\n]+\.ts(?:\?[^\n]*)?\s*(?:\n|$)/m.test(text);
  } catch (_) {
    return false;
  }
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
  clearPendingRestart(id);

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
    '-hls_delete_threshold', String(config.HLS_DELETE_THRESHOLD || 10),
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

    const existingEntry = activeStreams.get(id);
    if (existingEntry?.healthCheckTimer) {
      clearInterval(existingEntry.healthCheckTimer);
    }
    if (existingEntry?.monitorTimer) {
      clearInterval(existingEntry.monitorTimer);
    }

    activeStreams.delete(id);

    const wasIntentional = intentionallyStopped.has(id);
    intentionallyStopped.delete(id);

    // Update camera status in DB
    try {
      const db = getDb();
      db.prepare("UPDATE cameras SET status = 'offline', stream_pid = NULL WHERE id = ?").run(id);
    } catch (_) {}

    if (wasIntentional) return;

    // Restart after delay for any unintentional exit, including clean exits.
    // Some cameras close RTSP sessions periodically and FFmpeg exits with code 0.
    if (recentFfmpegLines.length > 0) {
      const tail = recentFfmpegLines.slice(-8).join('\n');
      console.error(`[StreamManager] Last FFmpeg output for camera ${id}:\n${tail}`);
    }

    scheduleRestart(id, `ffmpeg_exit_${code}`);
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
    monitorTimer: null,
    lastHealthyAt: null,
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
      entry.lastHealthyAt = Date.now();
      restartBackoffMs.set(id, MIN_RESTART_DELAY_MS);
      clearInterval(healthCheckTimer);
      try {
        const db = getDb();
        db.prepare(
          "UPDATE cameras SET status = 'online', stream_pid = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(proc.pid, id);
      } catch (_) {}
      return;
    }

    if (Date.now() - startedAt > STREAM_STARTUP_TIMEOUT_MS) {
      clearInterval(healthCheckTimer);
      entry.status = 'error';
      try {
        proc.kill('SIGTERM');
      } catch (_) {}
    }
  }, 1000);

  activeStreams.get(id).healthCheckTimer = healthCheckTimer;

  const monitorTimer = setInterval(() => {
    const entry = activeStreams.get(id);
    if (!entry || entry.process !== proc) {
      clearInterval(monitorTimer);
      return;
    }

    // Initial startup is handled by healthCheckTimer (45s timeout).
    // Avoid killing FFmpeg early before first healthy playlist appears.
    if (!entry.lastHealthyAt) {
      return;
    }

    if (isStreamHealthy(id)) {
      entry.lastHealthyAt = Date.now();
      if (entry.status !== 'streaming') {
        entry.status = 'streaming';
      }
      return;
    }

    const sinceHealthyMs = Date.now() - (entry.lastHealthyAt || startedAt);
    if (sinceHealthyMs > STREAM_STALE_AFTER_MS) {
      entry.status = 'error';
      console.warn(
        `[StreamManager] Stream for camera ${id} is stale for ${sinceHealthyMs}ms, restarting process.`
      );
      try {
        proc.kill('SIGTERM');
      } catch (_) {}
    }
  }, STREAM_MONITOR_INTERVAL_MS);

  activeStreams.get(id).monitorTimer = monitorTimer;
}

/**
 * Stop the stream for a camera.
 */
function stopStream(cameraId) {
  const id = parseInt(cameraId);
  clearPendingRestart(id);
  restartBackoffMs.delete(id);
  const entry = activeStreams.get(id);
  if (entry && entry.process) {
    intentionallyStopped.add(id);
    if (entry.healthCheckTimer) {
      clearInterval(entry.healthCheckTimer);
    }
    if (entry.monitorTimer) {
      clearInterval(entry.monitorTimer);
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
 * Probe camera RTSP connectivity and return a diagnostic result.
 */
function testRtspConnection(camera, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 12000;

  return new Promise((resolve) => {
    const ffmpegBin = resolveFfmpegBin();
    const args = [
      '-rtsp_transport', 'tcp',
      '-loglevel', 'error',
      '-i', buildRtspUrl(camera),
      '-t', '3',
      '-f', 'null',
      '-',
    ];

    let timedOut = false;
    const lines = [];

    const proc = spawn(ffmpegBin, args, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stderr.on('data', (data) => {
      const chunkLines = data.toString().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      chunkLines.forEach((line) => {
        lines.push(line);
        if (lines.length > 30) lines.shift();
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill('SIGTERM');
      } catch (_) {}
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        reason: 'spawn_error',
        message: 'Unable to start FFmpeg probe',
        detail: err.message,
      });
    });

    proc.on('exit', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        return resolve({
          ok: false,
          reason: 'timeout',
          message: 'RTSP probe timed out',
          detail: 'Camera did not respond before timeout',
        });
      }

      if (code === 0) {
        return resolve({
          ok: true,
          reason: 'ok',
          message: 'RTSP connection successful',
        });
      }

      const detail = lines.slice(-6).join(' | ') || 'Unknown RTSP probe error';
      const lowered = detail.toLowerCase();
      let reason = 'unknown';
      let message = 'RTSP probe failed';

      if (lowered.includes('401') || lowered.includes('unauthorized') || lowered.includes('authentication')) {
        reason = 'auth_failed';
        message = 'Authentication failed';
      } else if (
        lowered.includes('connection timed out') ||
        lowered.includes('operation timed out') ||
        lowered.includes('network is unreachable') ||
        lowered.includes('no route to host')
      ) {
        reason = 'network_unreachable';
        message = 'Camera network unreachable';
      } else if (lowered.includes('connection refused')) {
        reason = 'connection_refused';
        message = 'RTSP port refused the connection';
      } else if (
        lowered.includes('404') ||
        lowered.includes('not found') ||
        lowered.includes('method describe failed')
      ) {
        reason = 'invalid_path';
        message = 'RTSP path appears invalid';
      }

      return resolve({
        ok: false,
        reason,
        message,
        detail,
      });
    });
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
  testRtspConnection,
  getAllStreamStatuses,
  initializeStreams,
};
