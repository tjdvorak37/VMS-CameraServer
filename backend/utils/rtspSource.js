const crypto = require('crypto');

function buildDirectRtspUrl(camera, sourceUrl = null) {
  const effectiveUrl = sourceUrl || camera.rtsp_url;
  if (!camera.username && !camera.password) return effectiveUrl;

  try {
    const url = new URL(effectiveUrl);
    if (camera.username) url.username = camera.username;
    if (camera.password) url.password = camera.password;
    return url.toString();
  } catch (_) {
    return effectiveUrl;
  }
}

function getRtspProxyMode() {
  const mode = String(process.env.RTSP_PROXY_MODE || 'off').trim().toLowerCase();
  if (mode === 'mediamtx') return 'mediamtx';
  return 'off';
}

function isRtspProxyEnabled() {
  return getRtspProxyMode() !== 'off';
}

function getLegacySdpCameraIds() {
  const raw = String(process.env.LEGACY_SDP_CAMERA_IDS || '').trim();
  if (!raw) return new Set();

  return new Set(
    raw
      .split(',')
      .map(part => Number(part.trim()))
      .filter(Number.isInteger)
      .filter(id => id > 0)
  );
}

function isCameraMarkedLegacySdp(cameraId) {
  return getLegacySdpCameraIds().has(Number(cameraId));
}

function isCameraProxyPreferred(camera) {
  if (!camera) return false;
  const cameraForcesProxy = Number(camera.use_rtsp_proxy) === 1;
  return cameraForcesProxy || isCameraMarkedLegacySdp(camera.id);
}

function sanitizePathToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function buildProxyPath(camera) {
  const template = String(process.env.MEDIAMTX_PATH_TEMPLATE || 'camera-{id}').trim() || 'camera-{id}';
  const digest = crypto
    .createHash('sha1')
    .update(String(camera.rtsp_url || ''))
    .digest('hex')
    .slice(0, 10);

  const nameToken = sanitizePathToken(camera.name) || `camera-${camera.id}`;
  const ipToken = sanitizePathToken(camera.ip_address) || 'unknown-ip';

  const resolved = template
    .replaceAll('{id}', String(camera.id))
    .replaceAll('{name}', nameToken)
    .replaceAll('{ip}', ipToken)
    .replaceAll('{hash}', digest);

  return sanitizePathToken(resolved) || `camera-${camera.id}`;
}

function buildProxyRtspUrl(camera) {
  const base = String(process.env.MEDIAMTX_RTSP_URL || 'rtsp://mediamtx:8554').trim().replace(/\/+$/, '');
  return `${base}/${buildProxyPath(camera)}`;
}

function getMediaMtxApiBaseUrl() {
  return String(process.env.MEDIAMTX_API_URL || 'http://mediamtx:9997').trim().replace(/\/+$/, '');
}

async function requestMediaMtx(method, url, payload) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (response.ok || response.status === 409) {
    return { ok: true, status: response.status };
  }

  const text = await response.text();
  return {
    ok: false,
    status: response.status,
    detail: text || `HTTP ${response.status}`,
  };
}

async function ensureMediaMtxPath(camera, sourceRtspUrl) {
  if (getRtspProxyMode() !== 'mediamtx') {
    return { ok: false, reason: 'proxy_disabled' };
  }

  const pathName = buildProxyPath(camera);
  const encodedPath = encodeURIComponent(pathName);
  const baseUrl = getMediaMtxApiBaseUrl();
  const payload = {
    source: sourceRtspUrl,
    sourceOnDemand: true,
  };

  const attempts = [
    { method: 'POST', url: `${baseUrl}/v3/config/paths/add/${encodedPath}` },
    { method: 'POST', url: `${baseUrl}/v3/config/paths/patch/${encodedPath}` },
    { method: 'PATCH', url: `${baseUrl}/v3/config/paths/patch/${encodedPath}` },
  ];

  let lastError = 'Unknown MediaMTX API error';
  for (const attempt of attempts) {
    try {
      const result = await requestMediaMtx(attempt.method, attempt.url, payload);
      if (result.ok) {
        return {
          ok: true,
          pathName,
          status: result.status,
        };
      }
      lastError = result.detail || `HTTP ${result.status}`;
    } catch (err) {
      lastError = err.message;
    }
  }

  return {
    ok: false,
    pathName,
    reason: 'mediamtx_api_error',
    detail: lastError,
  };
}

module.exports = {
  buildDirectRtspUrl,
  getRtspProxyMode,
  isRtspProxyEnabled,
  getLegacySdpCameraIds,
  isCameraMarkedLegacySdp,
  isCameraProxyPreferred,
  buildProxyPath,
  buildProxyRtspUrl,
  ensureMediaMtxPath,
};