bcdedit /set hypervisorlaunchtype autoconst path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, Menu, shell, nativeImage } = require('electron');

const DEFAULT_SERVER_URL = process.env.VMS_SERVER_URL || 'http://localhost:3001';
const CONFIG_FILE = 'config.json';

let mainWindow;

function loadAppIcon() {
  const candidates = [
    path.join(__dirname, 'assets', 'vms-shield.png'),
    path.join(__dirname, 'assets', 'vms-shield.ico'),
  ];

  for (const iconPath of candidates) {
    if (!fs.existsSync(iconPath)) continue;

    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) return icon;
  }

  return null;
}

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function readConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function readBundledConfig() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'server-config.json'),
    path.join(__dirname, 'server-config.json'),
  ];

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.serverUrl === 'string') {
        return parsed;
      }
    } catch (_) {
      // Ignore invalid optional config files.
    }
  }

  return {};
}

function writeConfig(config) {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

function getServerUrl() {
  const cfg = readConfig();
  const bundled = readBundledConfig();
  return cfg.serverUrl || bundled.serverUrl || DEFAULT_SERVER_URL;
}

function normalizeServerUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return null;
  }
}

function openConnectScreen(failedUrl) {
  mainWindow.loadFile(path.join(__dirname, 'connect.html'));
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('vms-connect-init', {
      serverUrl: failedUrl || getServerUrl(),
    });
  });
}

function loadServer(url) {
  const normalized = normalizeServerUrl(url) || getServerUrl();
  mainWindow.loadURL(normalized).catch(() => {
    openConnectScreen(normalized);
  });
}

function createMenu() {
  const template = [
    {
      label: 'VMS',
      submenu: [
        {
          label: 'Connection Settings',
          click: () => openConnectScreen(getServerUrl()),
        },
        {
          label: 'Open In Default Browser',
          click: () => shell.openExternal(getServerUrl()),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const appIcon = loadAppIcon();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#0f172a',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'VMS Desktop Client',
    icon: appIcon || undefined,
  });

  mainWindow.webContents.on('did-fail-load', (_event, _errorCode, _errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (validatedURL.startsWith('file://')) return;
    openConnectScreen(validatedURL || getServerUrl());
  });

  loadServer(getServerUrl());
}

ipcMain.handle('vms:get-server-url', async () => getServerUrl());

ipcMain.handle('vms:save-server-url', async (_event, value) => {
  const normalized = normalizeServerUrl(value);
  if (!normalized) {
    return { ok: false, error: 'Please enter a valid http:// or https:// URL.' };
  }

  const cfg = readConfig();
  cfg.serverUrl = normalized;
  writeConfig(cfg);
  loadServer(normalized);

  return { ok: true, serverUrl: normalized };
});

app.whenReady().then(() => {
  const appIcon = loadAppIcon();
  if (appIcon && process.platform === 'darwin' && app.dock?.setIcon) {
    app.dock.setIcon(appIcon);
  }

  createMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
