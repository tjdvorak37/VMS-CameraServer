/**
 * Recording Manager Service
 * Manages continuous recording for cameras using FFmpeg segmented recording.
 * Segments are 10-minute MP4 files stored in the recordings directory.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');
const { getDb } = require('../config/database');

// Map of cameraId -> { process, currentFile, startedAt }
const activeRecordings = new Map();
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
 * Ensure recording directory exists for a camera.
 */
function ensureRecordingDir(cameraId) {
  const dir = path.join(config.RECORDINGS_DIR, String(cameraId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Format a date as YYYYMMDD_HHmmss for filenames.
 */
function formatTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '_').substring(0, 15);
}

/**
 * Start continuous recording for a camera.
 * Records to segmented MP4 files; registers each segment in the DB.
 */
function startRecording(camera) {
  const id = camera.id;
  intentionallyStopped.delete(id);

  if (activeRecordings.has(id)) {
    stopRecording(id);
  }

  const recDir = ensureRecordingDir(id);
  const ts = formatTimestamp();

  // Use segment muxer: creates files like recDir/20260317_120000.mp4
  const outputPattern = path.join(recDir, '%Y%m%d_%H%M%S.mp4');

  const args = [
    '-rtsp_transport', 'tcp',
    '-i', buildRtspUrl(camera),
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-f', 'segment',
    '-segment_time', String(config.SEGMENT_DURATION),
    '-segment_format', 'mp4',
    '-strftime', '1',
    '-reset_timestamps', '1',
    '-avoid_negative_ts', 'make_zero',
    '-y',
    outputPattern,
  ];

  const ffmpegBin = resolveFfmpegBin();

  console.log(`[RecordingManager] Starting recording for camera ${id} (${camera.name}) using ${ffmpegBin}`);

  const proc = spawn(ffmpegBin, args, {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let currentSegmentStart = new Date();
  let lastFile = null;

  // Parse FFmpeg stderr to detect segment changes
  proc.stderr.on('data', (data) => {
    const text = data.toString();

    // Detect opening of a new segment file
    const match = text.match(/Opening '([^']+\.mp4)' for writing/);
    if (match) {
      const newFile = match[1];

      // Close previous segment in DB
      if (lastFile) {
        finalizeSegment(id, lastFile, currentSegmentStart);
      }

      lastFile = newFile;
      currentSegmentStart = new Date();
    }
  });

  proc.on('exit', (code) => {
    console.log(`[RecordingManager] Recording for camera ${id} exited (code ${code})`);

    // Finalize last segment
    if (lastFile) finalizeSegment(id, lastFile, currentSegmentStart);

    activeRecordings.delete(id);
    try {
      const db = getDb();
      db.prepare('UPDATE cameras SET record_pid = NULL WHERE id = ?').run(id);
    } catch (_) {}

    const wasIntentional = intentionallyStopped.has(id);
    intentionallyStopped.delete(id);

    // Auto-restart on any unexpected exit (including code 0)
    // because some cameras/RTSP servers terminate sessions periodically.
    if (!wasIntentional) {
      setTimeout(() => {
        try {
          const db = getDb();
          const cam = db.prepare('SELECT * FROM cameras WHERE id = ? AND recording_enabled = 1').get(id);
          if (cam) startRecording(cam);
        } catch (_) {}
      }, 5000);
    }
  });

  proc.on('error', (err) => {
    console.error(`[RecordingManager] FFmpeg error for camera ${id}:`, err.message);
    activeRecordings.delete(id);
  });

  activeRecordings.set(id, {
    process: proc,
    startedAt: new Date().toISOString(),
    currentFile: null,
  });

  try {
    const db = getDb();
    db.prepare('UPDATE cameras SET record_pid = ? WHERE id = ?').run(proc.pid, id);
  } catch (_) {}
}

/**
 * Register a completed recording segment in the database.
 */
function finalizeSegment(cameraId, filePath, startTime) {
  try {
    if (!fs.existsSync(filePath)) return;

    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);

    const db = getDb();
    db.prepare(`
      INSERT INTO recordings (camera_id, file_path, start_time, end_time, file_size, duration)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      cameraId,
      filePath,
      startTime.toISOString(),
      endTime.toISOString(),
      fileSize,
      duration
    );
  } catch (err) {
    console.error('[RecordingManager] finalizeSegment error:', err.message);
  }
}

/**
 * Stop recording for a camera.
 */
function stopRecording(cameraId) {
  const id = parseInt(cameraId);
  const entry = activeRecordings.get(id);
  if (entry && entry.process) {
    intentionallyStopped.add(id);
    try { entry.process.kill('SIGTERM'); } catch (_) {}
    activeRecordings.delete(id);
  }

  try {
    const db = getDb();
    db.prepare('UPDATE cameras SET record_pid = NULL WHERE id = ?').run(id);
  } catch (_) {}
}

/**
 * Initialize recordings for all cameras on startup.
 */
function initializeRecordings() {
  try {
    const db = getDb();
    const cameras = db.prepare('SELECT * FROM cameras WHERE recording_enabled = 1').all();
    console.log(`[RecordingManager] Starting recordings for ${cameras.length} camera(s)...`);
    cameras.forEach((cam, i) => {
      // Stagger starts to reduce CPU spike
      setTimeout(() => startRecording(cam), 1000 + i * 500);
    });
  } catch (err) {
    console.error('[RecordingManager] Init error:', err);
  }
}

/**
 * Scan recording directory and sync any existing files to the database.
 * Useful after a restart.
 */
function syncExistingRecordings() {
  try {
    const db = getDb();
    const cameras = db.prepare('SELECT id FROM cameras').all();

    cameras.forEach(({ id }) => {
      const recDir = path.join(config.RECORDINGS_DIR, String(id));
      if (!fs.existsSync(recDir)) return;

      const files = fs.readdirSync(recDir).filter(f => f.endsWith('.mp4'));
      files.forEach(file => {
        const filePath = path.join(recDir, file);
        const existing = db.prepare('SELECT id FROM recordings WHERE file_path = ?').get(filePath);
        if (!existing) {
          const stats = fs.statSync(filePath);
          // Parse timestamp from filename YYYYMMDD_HHmmSS.mp4
          const match = file.match(/^(\d{8})_(\d{6})\.mp4$/);
          let startTime = new Date(stats.birthtime);
          if (match) {
            const [, d, t] = match;
            const iso = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`;
            startTime = new Date(iso);
          }

          db.prepare(`
            INSERT INTO recordings (camera_id, file_path, start_time, file_size)
            VALUES (?, ?, ?, ?)
          `).run(id, filePath, startTime.toISOString(), stats.size);
        }
      });
    });
  } catch (err) {
    console.error('[RecordingManager] sync error:', err);
  }
}

module.exports = {
  startRecording,
  stopRecording,
  initializeRecordings,
  syncExistingRecordings,
  finalizeSegment,
};
