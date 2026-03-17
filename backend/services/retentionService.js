/**
 * Retention Service
 * Automatically purges recordings older than the configured retention period (default 30 days).
 * Runs daily via node-cron.
 */
const fs = require('fs');
const cron = require('node-cron');
const { getDb } = require('../config/database');
const config = require('../config/config');

/**
 * Delete recordings older than `days` days.
 */
function purgeOldRecordings(days) {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString();

  const oldRecordings = db.prepare(
    'SELECT id, file_path FROM recordings WHERE start_time < ?'
  ).all(cutoffISO);

  if (oldRecordings.length === 0) {
    console.log('[Retention] No recordings to purge.');
    return { purged: 0, freedBytes: 0 };
  }

  let freedBytes = 0;
  let purged = 0;
  const errors = [];

  oldRecordings.forEach(rec => {
    try {
      if (rec.file_path && fs.existsSync(rec.file_path)) {
        const stat = fs.statSync(rec.file_path);
        fs.unlinkSync(rec.file_path);
        freedBytes += stat.size;
      }
      db.prepare('DELETE FROM recordings WHERE id = ?').run(rec.id);
      purged++;
    } catch (err) {
      errors.push({ id: rec.id, error: err.message });
    }
  });

  // Also delete expired events (older than 30 days)
  db.prepare("DELETE FROM events WHERE created_at < ?").run(cutoffISO);

  console.log(
    `[Retention] Purged ${purged} recording(s), freed ${(freedBytes / 1024 / 1024).toFixed(2)} MB.` +
    (errors.length ? ` ${errors.length} error(s).` : '')
  );

  return { purged, freedBytes, errors };
}

/**
 * Start the daily retention cron job.
 * Runs at 2:00 AM every day.
 */
function startRetentionJob() {
  cron.schedule('0 2 * * *', () => {
    try {
      const db = getDb();
      const setting = db.prepare("SELECT value FROM system_settings WHERE key = 'retention_days'").get();
      const days = setting ? parseInt(setting.value) : config.RETENTION_DAYS;
      console.log(`[Retention] Running daily purge (${days} day retention)...`);
      purgeOldRecordings(days);
    } catch (err) {
      console.error('[Retention] Cron error:', err);
    }
  });

  // Also run a periodic disk space monitor every 6 hours
  cron.schedule('0 */6 * * *', () => {
    logDiskUsage();
  });

  console.log('[Retention] Daily purge job scheduled (2:00 AM).');
}

/**
 * Log approximate disk usage of recordings directory.
 */
function logDiskUsage() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM recordings').get();
    const gb = (row.total / 1024 / 1024 / 1024).toFixed(3);
    console.log(`[Retention] Current recording storage: ${gb} GB`);
  } catch (_) {}
}

module.exports = { startRetentionJob, purgeOldRecordings };
