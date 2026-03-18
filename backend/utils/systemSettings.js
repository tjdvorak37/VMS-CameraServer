function getSystemSetting(db, key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSystemSetting(db, key, value) {
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, String(value));
}

function isSetupCompleted(db) {
  return getSystemSetting(db, 'setup_completed', 'true') === 'true';
}

module.exports = {
  getSystemSetting,
  setSystemSetting,
  isSetupCompleted,
};
