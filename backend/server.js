require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const config = require('./config/config');
const { getDb } = require('./config/database');

// Routes
const authRoutes       = require('./routes/auth');
const userRoutes       = require('./routes/users');
const cameraRoutes     = require('./routes/cameras');
const streamRoutes     = require('./routes/streams');
const recordingRoutes  = require('./routes/recordings');
const eventRoutes      = require('./routes/events');
const dashboardRoutes  = require('./routes/dashboard');

// Services
const streamManager    = require('./services/streamManager');
const recordingManager = require('./services/recordingManager');
const { startRetentionJob } = require('./services/retentionService');
const { authenticate } = require('./middleware/auth');

// ─── Ensure data directories exist ─────────────────────────────────────────
[
  config.RECORDINGS_DIR,
  config.STREAMS_DIR,
  config.SNAPSHOTS_DIR,
  config.THUMBNAILS_DIR,
  path.dirname(config.DB_PATH),
].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Express app setup ──────────────────────────────────────────────────────
const app = express();

// Security headers (relax CSP for HLS video)
app.use(
  helmet({
    contentSecurityPolicy: false, // Handled by frontend
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());
app.use(morgan('combined'));

// CORS
app.use(cors({
  origin: config.CORS_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rate limiting ──────────────────────────────────────────────────────────
app.use('/api/auth/login', rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW,
  max: config.LOGIN_RATE_LIMIT_MAX,
  message: { error: 'Too many login attempts, please try again later' },
}));

app.use('/api/', rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ─── Static files ───────────────────────────────────────────────────────────
// Serve frontend build in production
const frontendBuild = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendBuild)) {
  app.use(express.static(frontendBuild));
}

// Serve snapshots and thumbnails as static
app.use('/snapshots', authenticate, express.static(config.SNAPSHOTS_DIR));
app.use('/thumbnails', authenticate, express.static(config.THUMBNAILS_DIR));

// ─── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/users',      userRoutes);
app.use('/api/cameras',    cameraRoutes);
app.use('/api/streams',    streamRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/events',     eventRoutes);
app.use('/api/dashboard',  dashboardRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// SPA fallback — serve index.html for all non-API routes
if (fs.existsSync(frontendBuild)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendBuild, 'index.html'));
  });
}

// ─── HTTP server + WebSocket ─────────────────────────────────────────────────
const server = http.createServer(app);

// WebSocket server for real-time events & notifications
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  // Basic auth: expect token as query param ?token=...
  const url = new URL(req.url, `http://localhost`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  try {
    const jwt = require('jsonwebtoken');
    jwt.verify(token, config.JWT_SECRET);
  } catch {
    ws.close(1008, 'Invalid token');
    return;
  }

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.send(JSON.stringify({ type: 'connected', message: 'VMS Connected' }));
});

// Heartbeat ping to detect dead connections
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

/**
 * Broadcast a message to all connected WebSocket clients.
 */
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

// Make broadcast available globally for services
global.vmsBroadcast = broadcast;

// ─── Startup ─────────────────────────────────────────────────────────────────
async function start() {
  // Initialize database
  getDb();
  console.log('[VMS] Database initialized.');

  // Sync existing recording files
  recordingManager.syncExistingRecordings();

  // Start live streams for all cameras
  streamManager.initializeStreams();

  // Start recording for all enabled cameras
  recordingManager.initializeRecordings();

  // Start 30-day retention purge job
  startRetentionJob();

  // Start HTTP server
  server.listen(config.PORT, '0.0.0.0', () => {
    console.log(`\n┌─────────────────────────────────────────┐`);
    console.log(`│  VMS Camera Server v1.0.0               │`);
    console.log(`│  API:  http://0.0.0.0:${config.PORT}              │`);
    console.log(`│  WS:   ws://0.0.0.0:${config.PORT}/ws             │`);
    console.log(`└─────────────────────────────────────────┘\n`);
  });
}

// Graceful shutdown
function shutdown() {
  console.log('\n[VMS] Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch(err => {
  console.error('[VMS] Fatal startup error:', err);
  process.exit(1);
});
