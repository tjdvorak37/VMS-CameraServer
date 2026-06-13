// Application configuration
const path = require('path');
const crypto = require('crypto');

function resolveSecret(name) {
  const value = process.env[name];
  if (value && value.trim()) return value.trim();

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} is required in production`);
  }

  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  // Server
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // JWT
  JWT_SECRET: resolveSecret('JWT_SECRET'),
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
  FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
  HLS_TIME: parseInt(process.env.HLS_TIME) || 2,        // seconds per HLS chunk
  HLS_LIST_SIZE: parseInt(process.env.HLS_LIST_SIZE) || 12, // chunks in playlist
  HLS_DELETE_THRESHOLD: parseInt(process.env.HLS_DELETE_THRESHOLD) || 30,

  // Network discovery
  DISCOVERY_TIMEOUT: parseInt(process.env.DISCOVERY_TIMEOUT) || 5000,
  ONVIF_DISCOVERY_TIMEOUT: parseInt(process.env.ONVIF_DISCOVERY_TIMEOUT) || 5000,
  NETWORK_SCAN_TIMEOUT: parseInt(process.env.NETWORK_SCAN_TIMEOUT) || 3000,
  DISCOVERY_SUBNETS: process.env.DISCOVERY_SUBNETS
    ? process.env.DISCOVERY_SUBNETS.split(',').map(s => s.trim()).filter(Boolean)
    : [],
  DISCOVERY_MAX_HOSTS: parseInt(process.env.DISCOVERY_MAX_HOSTS) || 512,

  // CORS
  CORS_ORIGINS: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001'],
};