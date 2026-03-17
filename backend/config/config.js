// Application configuration
const path = require('path');

module.exports = {
  // Server
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'vms-super-secret-key-change-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  // Database
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../data/vms.db'),

  // Storage directories
  RECORDINGS_DIR: process.env.RECORDINGS_DIR || path.join(__dirname, '../data/recordings'),
  STREAMS_DIR: process.env.STREAMS_DIR || path.join(__dirname, '../data/streams'),
  SNAPSHOTS_DIR: process.env.SNAPSHOTS_DIR || path.join(__dirname, '../data/snapshots'),
  THUMBNAILS_DIR: process.env.THUMBNAILS_DIR || path.join(__dirname, '../data/thumbnails'),

  // Recording settings
  RETENTION_DAYS: parseInt(process.env.RETENTION_DAYS) || 30,
  SEGMENT_DURATION: parseInt(process.env.SEGMENT_DURATION) || 600, // seconds (10 min segments)

  // HLS settings
  HLS_TIME: parseInt(process.env.HLS_TIME) || 2,        // seconds per HLS chunk
  HLS_LIST_SIZE: parseInt(process.env.HLS_LIST_SIZE) || 5, // chunks in playlist

  // Network discovery
  DISCOVERY_TIMEOUT: parseInt(process.env.DISCOVERY_TIMEOUT) || 5000,
  ONVIF_DISCOVERY_TIMEOUT: parseInt(process.env.ONVIF_DISCOVERY_TIMEOUT) || 5000,
  NETWORK_SCAN_TIMEOUT: parseInt(process.env.NETWORK_SCAN_TIMEOUT) || 3000,

  // CORS
  CORS_ORIGINS: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001'],

  // Rate limiting
  RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX: 200,
  LOGIN_RATE_LIMIT_MAX: 10,
};
