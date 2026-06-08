#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function fail(message) {
  console.error(`[VMS-SERVICE] ${message}`);
  process.exit(1);
}

if (process.platform !== 'win32') {
  fail('This service installer can only run on Windows.');
}

const args = parseArgs(process.argv.slice(2));
const installDir = path.resolve(args.installDir || '');
const backendDir = path.resolve(args.backendDir || '');
const serviceName = String(args.serviceName || '').trim();
const serviceDescription = String(args.serviceDescription || 'VMS Camera Server backend service').trim();
const noStart = Boolean(args.noStart);

if (!installDir || !backendDir || !serviceName) {
  fail('Missing required arguments. Expected --installDir, --backendDir, and --serviceName.');
}

const serviceScript = path.join(backendDir, 'server.js');
if (!fs.existsSync(serviceScript)) {
  fail(`Backend entrypoint not found: ${serviceScript}`);
}

const nodeWindowsPath = path.join(backendDir, 'node_modules', 'node-windows');
if (!fs.existsSync(nodeWindowsPath)) {
  fail(`node-windows was not found under: ${nodeWindowsPath}`);
}

const { Service } = require(nodeWindowsPath);
const logsDir = path.join(backendDir, 'logs');
fs.mkdirSync(logsDir, { recursive: true });

const service = new Service({
  name: serviceName,
  description: serviceDescription,
  script: serviceScript,
  execPath: process.execPath,
  workingDirectory: backendDir,
  logpath: logsDir,
  logging: { mode: 'append' },
});

let finished = false;
function finish(code, message) {
  if (finished) {
    return;
  }
  finished = true;
  if (message) {
    console.log(`[VMS-SERVICE] ${message}`);
  }
  process.exit(code);
}

service.on('install', () => {
  if (noStart) {
    finish(0, `Service installed: ${serviceName}`);
    return;
  }

  console.log(`[VMS-SERVICE] Service installed: ${serviceName}. Starting...`);
  try {
    service.start();
  } catch (error) {
    fail(`Service install succeeded but start failed: ${error.message}`);
  }
});

service.on('alreadyinstalled', () => {
  if (noStart) {
    finish(0, `Service already installed: ${serviceName}`);
    return;
  }

  console.log(`[VMS-SERVICE] Service already installed: ${serviceName}. Starting...`);
  try {
    service.start();
  } catch (error) {
    fail(`Service start failed: ${error.message}`);
  }
});

service.on('start', () => {
  finish(0, `Service started: ${serviceName}`);
});

service.on('error', (error) => {
  fail(error && error.message ? error.message : String(error));
});

try {
  service.install();
} catch (error) {
  fail(error && error.message ? error.message : String(error));
}
