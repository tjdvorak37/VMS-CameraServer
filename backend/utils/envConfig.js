const fs = require('fs');
const path = require('path');

const ENV_FILE_PATH = path.resolve(__dirname, '../../.env');
const ENV_EXAMPLE_PATH = path.resolve(__dirname, '../../.env.example');

const FIELD_TO_ENV_KEY = {
  node_env: 'NODE_ENV',
  port: 'PORT',
  vms_port: 'VMS_PORT',
  cors_origins: 'CORS_ORIGINS',
  segment_duration: 'SEGMENT_DURATION',
};

const SERVER_ENV_DEFAULTS = {
  node_env: 'production',
  port: '3001',
  vms_port: '8080',
  cors_origins: 'http://localhost:5173,http://localhost:3001',
  segment_duration: '600',
};

const RESTART_REQUIRED_FIELDS = Object.keys(FIELD_TO_ENV_KEY);

function stripWrappedQuotes(value) {
  const trimmed = value.trim();
  const wrappedInDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
  const wrappedInSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'");

  if (wrappedInDoubleQuotes || wrappedInSingleQuotes) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseEnvContent(content) {
  const parsed = {};

  content
    .split(/\r?\n/)
    .forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) return;

      const [, key, rawValue] = match;
      parsed[key] = stripWrappedQuotes(rawValue);
    });

  return parsed;
}

function getEnvSourceContent() {
  if (fs.existsSync(ENV_FILE_PATH)) {
    return fs.readFileSync(ENV_FILE_PATH, 'utf8');
  }

  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    return fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  }

  return '';
}

function isWritable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureEnvFileExists() {
  if (fs.existsSync(ENV_FILE_PATH)) return;

  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_FILE_PATH);
  } else {
    fs.writeFileSync(ENV_FILE_PATH, '', 'utf8');
  }
}

function normalizeIncomingValue(value) {
  const normalized = String(value ?? '').trim();

  if (normalized.includes('\n') || normalized.includes('\r')) {
    throw new Error('Invalid value: multiline values are not supported');
  }

  return normalized;
}

function formatValueForEnv(normalizedValue) {
  if (normalizedValue === '') return '';

  // Quote values that include whitespace or comment markers.
  if (/\s|#/.test(normalizedValue)) {
    return JSON.stringify(normalizedValue);
  }

  return normalizedValue;
}

function readServerEnvSettings() {
  const content = getEnvSourceContent();
  const parsed = parseEnvContent(content);
  const envFileExists = fs.existsSync(ENV_FILE_PATH);

  return {
    values: {
      node_env: parsed.NODE_ENV || SERVER_ENV_DEFAULTS.node_env,
      port: parsed.PORT || SERVER_ENV_DEFAULTS.port,
      vms_port: parsed.VMS_PORT || SERVER_ENV_DEFAULTS.vms_port,
      cors_origins: parsed.CORS_ORIGINS || SERVER_ENV_DEFAULTS.cors_origins,
      segment_duration: parsed.SEGMENT_DURATION || SERVER_ENV_DEFAULTS.segment_duration,
    },
    envFileExists,
    envFileWritable: envFileExists ? isWritable(ENV_FILE_PATH) : isWritable(path.dirname(ENV_FILE_PATH)),
  };
}

function updateServerEnvSettings(fieldValues) {
  ensureEnvFileExists();

  const beforeContent = fs.readFileSync(ENV_FILE_PATH, 'utf8');
  const beforeParsed = parseEnvContent(beforeContent);
  const lines = beforeContent.split(/\r?\n/);

  const updates = [];
  Object.entries(FIELD_TO_ENV_KEY).forEach(([field, envKey]) => {
    if (fieldValues[field] === undefined) return;

    const normalized = normalizeIncomingValue(fieldValues[field]);
    const current = (beforeParsed[envKey] ?? '').trim();

    if (current !== normalized) {
      updates.push({ field, envKey, value: normalized });
    }
  });

  if (updates.length === 0) {
    return { changedFields: [], changedEnvKeys: [] };
  }

  const byEnvKey = new Map(updates.map(update => [update.envKey, update]));
  const seenEnvKeys = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) continue;

    const envKey = match[1];
    const update = byEnvKey.get(envKey);
    if (!update) continue;

    lines[i] = `${envKey}=${formatValueForEnv(update.value)}`;
    seenEnvKeys.add(envKey);
  }

  updates.forEach(update => {
    if (seenEnvKeys.has(update.envKey)) return;
    lines.push(`${update.envKey}=${formatValueForEnv(update.value)}`);
  });

  const output = lines
    .filter((line, idx) => !(idx === lines.length - 1 && line === ''))
    .join('\n');

  fs.writeFileSync(ENV_FILE_PATH, `${output}\n`, 'utf8');

  return {
    changedFields: updates.map(update => update.field),
    changedEnvKeys: updates.map(update => update.envKey),
  };
}

module.exports = {
  readServerEnvSettings,
  updateServerEnvSettings,
  RESTART_REQUIRED_FIELDS,
};
