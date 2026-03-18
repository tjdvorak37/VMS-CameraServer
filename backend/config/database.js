const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

let db;

/**
 * Return existing column names for a table.
 */
function getTableColumns(db, tableName) {
  return new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all().map(col => col.name)
  );
}

/**
 * Add any missing columns for legacy installs.
 */
function ensureColumns(db, tableName, definitions) {
  const existing = getTableColumns(db, tableName);

  definitions.forEach(([columnName, columnDef]) => {
    if (!existing.has(columnName)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
      console.log(`[DB] Added missing column: ${tableName}.${columnName}`);
    }
  });
}

/**
 * Lightweight schema migrations for installs created by older versions.
 */
function runMigrations(db) {
  ensureColumns(db, 'cameras', [
    ['protocol', "TEXT DEFAULT 'RTSP'"],
    ['manufacturer', 'TEXT'],
    ['model', 'TEXT'],
    ['location', 'TEXT'],
    ['status', "TEXT DEFAULT 'offline'"],
    ['recording_enabled', 'INTEGER DEFAULT 1'],
    ['snapshot_url', 'TEXT'],
    ['onvif_port', 'INTEGER DEFAULT 80'],
    ['resolution', "TEXT DEFAULT '1920x1080'"],
    ['fps', 'INTEGER DEFAULT 15'],
    ['stream_pid', 'INTEGER'],
    ['record_pid', 'INTEGER'],
    ['last_seen', 'DATETIME'],
    ['thumbnail_path', 'TEXT'],
  ]);
}

function getDb() {
  if (!db) {
    // Ensure data directory exists
    const dataDir = path.dirname(config.DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(config.DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');

    initializeSchema(db);
    runMigrations(db);
    seedDefaultAdmin(db);
  }
  return db;
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT UNIQUE NOT NULL,
      email     TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role      TEXT NOT NULL DEFAULT 'viewer',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    );

    CREATE TABLE IF NOT EXISTS cameras (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT NOT NULL,
      ip_address       TEXT NOT NULL,
      port             INTEGER DEFAULT 554,
      rtsp_url         TEXT NOT NULL,
      username         TEXT,
      password         TEXT,
      protocol         TEXT DEFAULT 'RTSP',
      manufacturer     TEXT,
      model            TEXT,
      location         TEXT,
      status           TEXT DEFAULT 'offline',
      recording_enabled INTEGER DEFAULT 1,
      snapshot_url     TEXT,
      onvif_port       INTEGER DEFAULT 80,
      resolution       TEXT DEFAULT '1920x1080',
      fps              INTEGER DEFAULT 15,
      stream_pid       INTEGER,
      record_pid       INTEGER,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen        DATETIME,
      thumbnail_path   TEXT
    );

    CREATE TABLE IF NOT EXISTS recordings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id   INTEGER NOT NULL,
      file_path   TEXT NOT NULL,
      start_time  DATETIME NOT NULL,
      end_time    DATETIME,
      file_size   INTEGER DEFAULT 0,
      duration    INTEGER DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id    INTEGER,
      event_type   TEXT NOT NULL,
      description  TEXT,
      severity     TEXT DEFAULT 'info',
      recording_id INTEGER,
      thumbnail_path TEXT,
      acknowledged INTEGER DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL,
      FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS camera_permissions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      camera_id   INTEGER NOT NULL,
      can_view    INTEGER DEFAULT 1,
      can_ptz     INTEGER DEFAULT 0,
      can_export  INTEGER DEFAULT 0,
      UNIQUE(user_id, camera_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_recordings_camera_id ON recordings(camera_id);
    CREATE INDEX IF NOT EXISTS idx_recordings_start_time ON recordings(start_time);
    CREATE INDEX IF NOT EXISTS idx_events_camera_id ON events(camera_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_acknowledged ON events(acknowledged);
  `);
}

function seedDefaultAdmin(db) {
  const bcrypt = require('bcryptjs');
  const crypto = require('crypto');
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  let createdDefaultAdmin = false;

  if (userCount === 0) {
    const bootstrapPassword = crypto.randomBytes(24).toString('hex');
    const hash = bcrypt.hashSync(bootstrapPassword, 12);
    db.prepare(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run('admin', 'admin@vms.local', hash, 'admin');
    createdDefaultAdmin = true;
    console.log('[DB] Bootstrap admin created for initial setup.');
  }

  // Default system settings
  const defaults = [
    ['retention_days', '30'],
    ['max_cameras', '64'],
    ['snapshot_interval', '60'],
    ['email_alerts', 'false'],
    ['smtp_host', ''],
    ['smtp_port', '587'],
    ['public_base_url', ''],
    ['setup_completed', 'true'],
    ['setup_completed_at', ''],
  ];
  const upsert = db.prepare(`
    INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)
  `);
  defaults.forEach(([k, v]) => upsert.run(k, v));

  if (createdDefaultAdmin) {
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `).run('setup_completed', 'false');

    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `).run('setup_completed_at', '');
  }
}

module.exports = { getDb };
