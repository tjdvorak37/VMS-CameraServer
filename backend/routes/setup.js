const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');

const config = require('../config/config');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const {
  getSystemSetting,
  setSystemSetting,
  isSetupCompleted,
} = require('../utils/systemSettings');
const {
  readServerEnvSettings,
  updateServerEnvSettings,
  RESTART_REQUIRED_FIELDS,
} = require('../utils/envConfig');

// GET /api/setup/status
router.get('/status', (req, res) => {
  const db = getDb();

  return res.json({
    setupCompleted: isSetupCompleted(db),
    defaults: {
      retention_days: getSystemSetting(db, 'retention_days', '30'),
      max_cameras: getSystemSetting(db, 'max_cameras', '64'),
      snapshot_interval: getSystemSetting(db, 'snapshot_interval', '60'),
    },
  });
});

// POST /api/setup/complete
router.post(
  '/complete',
  [
    body('username')
      .trim()
      .isLength({ min: 3, max: 32 })
      .withMessage('Username must be between 3 and 32 characters')
      .matches(/^[A-Za-z0-9._-]+$/)
      .withMessage('Username may only contain letters, numbers, ., _, and -'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 8, max: 128 })
      .withMessage('Password must be between 8 and 128 characters'),
    body('retention_days')
      .optional()
      .isInt({ min: 1, max: 3650 })
      .withMessage('Retention must be between 1 and 3650 days'),
    body('max_cameras')
      .optional()
      .isInt({ min: 1, max: 1024 })
      .withMessage('Max cameras must be between 1 and 1024'),
    body('snapshot_interval')
      .optional()
      .isInt({ min: 10, max: 86400 })
      .withMessage('Snapshot interval must be between 10 and 86400 seconds'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const db = getDb();

    if (isSetupCompleted(db)) {
      return res.status(409).json({ error: 'Initial setup has already been completed' });
    }

    const { username, email, password } = req.body;

    const targetAdmin = db.prepare(
      "SELECT id FROM users WHERE username = 'admin' ORDER BY id ASC LIMIT 1"
    ).get();

    const usernameConflict = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (usernameConflict && (!targetAdmin || usernameConflict.id !== targetAdmin.id)) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const emailConflict = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (emailConflict && (!targetAdmin || emailConflict.id !== targetAdmin.id)) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const retentionDays = req.body.retention_days ?? getSystemSetting(db, 'retention_days', '30');
    const maxCameras = req.body.max_cameras ?? getSystemSetting(db, 'max_cameras', '64');
    const snapshotInterval = req.body.snapshot_interval ?? getSystemSetting(db, 'snapshot_interval', '60');

    try {
      const hash = await bcrypt.hash(password, 12);

      const completeSetup = db.transaction(() => {
        if (targetAdmin) {
          db.prepare(`
            UPDATE users
            SET username = ?,
                email = ?,
                password_hash = ?,
                role = 'admin',
                is_active = 1
            WHERE id = ?
          `).run(username, email, hash, targetAdmin.id);
        } else {
          db.prepare(`
            INSERT INTO users (username, email, password_hash, role, is_active)
            VALUES (?, ?, ?, 'admin', 1)
          `).run(username, email, hash);
        }

        setSystemSetting(db, 'retention_days', retentionDays);
        setSystemSetting(db, 'max_cameras', maxCameras);
        setSystemSetting(db, 'snapshot_interval', snapshotInterval);
        setSystemSetting(db, 'setup_completed', 'true');
        setSystemSetting(db, 'setup_completed_at', new Date().toISOString());
      });

      completeSetup();

      return res.status(201).json({
        message: 'Initial setup completed successfully',
        user: { username, email },
      });
    } catch (err) {
      console.error('[Setup] Complete setup error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/setup/server-config
router.get('/server-config', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required' });
  }

  const db = getDb();
  const envSettings = readServerEnvSettings();

  return res.json({
    values: {
      ...envSettings.values,
      public_base_url: getSystemSetting(db, 'public_base_url', ''),
    },
    runtime: {
      node_env: config.NODE_ENV,
      port: String(config.PORT),
      cors_origins: Array.isArray(config.CORS_ORIGINS) ? config.CORS_ORIGINS.join(',') : '',
      segment_duration: String(config.SEGMENT_DURATION),
    },
    env: {
      file: '.env',
      exists: envSettings.envFileExists,
      writable: envSettings.envFileWritable,
    },
    restartRequiredFields: RESTART_REQUIRED_FIELDS,
    note: 'Changes to .env values require a backend restart to take effect.',
  });
});

// PUT /api/setup/server-config
router.put(
  '/server-config',
  authenticate,
  [
    body('node_env')
      .optional()
      .isIn(['development', 'production'])
      .withMessage('Node environment must be development or production'),
    body('port')
      .optional()
      .isInt({ min: 1, max: 65535 })
      .withMessage('Backend port must be between 1 and 65535'),
    body('vms_port')
      .optional()
      .isInt({ min: 1, max: 65535 })
      .withMessage('Public port must be between 1 and 65535'),
    body('segment_duration')
      .optional()
      .isInt({ min: 10, max: 86400 })
      .withMessage('Segment duration must be between 10 and 86400 seconds'),
    body('cors_origins')
      .optional()
      .custom(value => {
        const origins = String(value)
          .split(',')
          .map(origin => origin.trim())
          .filter(Boolean);

        if (origins.length === 0) {
          throw new Error('At least one CORS origin is required');
        }

        origins.forEach(origin => {
          let parsed;
          try {
            parsed = new URL(origin);
          } catch {
            throw new Error(`Invalid CORS origin: ${origin}`);
          }

          if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error(`CORS origin must use http/https: ${origin}`);
          }
        });

        return true;
      }),
    body('public_base_url')
      .optional()
      .custom(value => {
        const normalized = String(value).trim();
        if (normalized === '') return true;

        let parsed;
        try {
          parsed = new URL(normalized);
        } catch {
          throw new Error('Public base URL must be a valid URL');
        }

        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('Public base URL must use http/https');
        }

        return true;
      }),
  ],
  (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin required' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const hasPublicBaseUrl = Object.prototype.hasOwnProperty.call(req.body, 'public_base_url');
    const envPayload = {
      node_env: req.body.node_env,
      port: req.body.port,
      vms_port: req.body.vms_port,
      cors_origins: req.body.cors_origins,
      segment_duration: req.body.segment_duration,
    };
    const hasEnvUpdates = Object.values(envPayload).some(value => value !== undefined);

    if (!hasEnvUpdates && !hasPublicBaseUrl) {
      return res.status(400).json({ error: 'No server configuration values provided' });
    }

    const db = getDb();
    const changedFields = [];

    try {
      if (hasEnvUpdates) {
        const envResult = updateServerEnvSettings(envPayload);
        changedFields.push(...envResult.changedFields);
      }

      if (hasPublicBaseUrl) {
        const nextPublicBaseUrl = String(req.body.public_base_url || '').trim();
        const currentPublicBaseUrl = getSystemSetting(db, 'public_base_url', '');

        if (nextPublicBaseUrl !== currentPublicBaseUrl) {
          setSystemSetting(db, 'public_base_url', nextPublicBaseUrl);
          changedFields.push('public_base_url');
        }
      }

      const restartRequiredFieldsChanged = changedFields.filter(field => RESTART_REQUIRED_FIELDS.includes(field));

      return res.json({
        message: 'Server configuration saved',
        changedFields,
        restartRequired: restartRequiredFieldsChanged.length > 0,
        restartRequiredFieldsChanged,
      });
    } catch (err) {
      console.error('[Setup] Server config update error:', err);
      return res.status(500).json({ error: 'Failed to update server configuration' });
    }
  }
);

module.exports = router;
