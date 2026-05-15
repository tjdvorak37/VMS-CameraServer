/**
 * Camera Discovery Service
 * Discovers IP cameras on the local network via ONVIF WS-Discovery
 * and direct RTSP probing.
 */
const dgram = require('dgram');
const net = require('net');
const os = require('os');
const config = require('../config/config');
const { getDb } = require('../config/database');
const { getSystemSetting } = require('../utils/systemSettings');

// ONVIF WS-Discovery multicast
const ONVIF_MULTICAST_ADDR = '239.255.255.250';
const ONVIF_PORT = 3702;

const MANUFACTURER_PATTERNS = [
  { name: 'Avigilon', pattern: /\bavigilon\b|\bava\s*security\b|\bmotorola\s*solutions\b/i },
  { name: 'Axis', pattern: /\baxis\b/i },
  { name: 'Bosch', pattern: /\bbosch\b/i },
  { name: 'Hanwha', pattern: /\bhanwha\b|\bsamsung\s*techwin\b|\bwisenet\b/i },
  { name: 'Pelco', pattern: /\bpelco\b/i },
  { name: 'Honeywell', pattern: /\bhoneywell\b/i },
  { name: 'Sony', pattern: /\bsony\b/i },
  { name: 'Panasonic', pattern: /\bpanasonic\b/i },
  { name: 'Hikvision', pattern: /\bhikvision\b/i },
  { name: 'Dahua', pattern: /\bdahua\b|\bamcrest\b/i },
  { name: 'Uniview', pattern: /\buniview\b|\bunisight\b|\bunv\b/i },
  { name: 'Mobotix', pattern: /\bmobotix\b/i },
  { name: 'Vivotek', pattern: /\bvivotek\b/i },
  { name: 'Arecont Vision', pattern: /\barecont\b/i },
  { name: 'FLIR', pattern: /\bflir\b/i },
];

const AVIGILON_ALIKE_MANUFACTURERS = new Set([
  'Avigilon',
  'Axis',
  'Bosch',
  'Hanwha',
  'Pelco',
  'Honeywell',
  'Sony',
  'Panasonic',
  'Hikvision',
  'Dahua',
  'Uniview',
  'Mobotix',
  'Vivotek',
  'Arecont Vision',
  'FLIR',
]);

const STYLE_RULES = [
  { style: 'PTZ', pattern: /\bptz\b|speed\s*dome|auto\s*dome/i },
  { style: 'Fisheye/Panoramic', pattern: /fisheye|\b360\b|panoramic|hemispheric/i },
  { style: 'Multi-Sensor', pattern: /multi[-\s]?sensor|multisensor|multidirectional|\bquad\b/i },
  { style: 'Thermal', pattern: /thermal|heat\s*camera/i },
  { style: 'Bullet/Box', pattern: /\bbullet\b|\bbox\b/i },
  { style: 'Dome/Turret', pattern: /\bdome\b|\bturret\b/i },
];

function safeDecode(value = '') {
  try {
    return decodeURIComponent(value.replace(/\+/g, '%20'));
  } catch (_) {
    return value;
  }
}

function extractTagValue(xml, tagName) {
  const match = xml.match(new RegExp(`${tagName}[^>]*>([^<]+)<`, 'i'));
  return match ? match[1].trim() : '';
}

function isValidIpv4(ip) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)
    && ip.split('.').every(part => Number(part) >= 0 && Number(part) <= 255);
}

function ipToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function intToIp(intVal) {
  return [
    (intVal >>> 24) & 255,
    (intVal >>> 16) & 255,
    (intVal >>> 8) & 255,
    intVal & 255,
  ].join('.');
}

function normalizeSubnetInput(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;

  if (isValidIpv4(value)) return `${value}/24`;

  const parts = value.split('/');
  if (parts.length !== 2) return null;
  if (!isValidIpv4(parts[0])) return null;

  const bits = Number(parts[1]);
  if (!Number.isInteger(bits) || bits < 1 || bits > 30) return null;
  return `${parts[0]}/${bits}`;
}

function expandCidrHosts(cidr, maxHosts) {
  const normalized = normalizeSubnetInput(cidr);
  if (!normalized) return [];

  const [ip, prefixRaw] = normalized.split('/');
  const prefix = Number(prefixRaw);
  const baseInt = ipToInt(ip);
  const hostBits = 32 - prefix;
  const totalHosts = Math.max(0, Math.pow(2, hostBits) - 2);
  const capped = Math.min(totalHosts, maxHosts);
  if (capped <= 0) return [];

  const mask = prefix === 0 ? 0 : ((0xffffffff << hostBits) >>> 0);
  const network = baseInt & mask;

  const hosts = [];
  for (let i = 1; i <= capped; i += 1) {
    hosts.push(intToIp((network + i) >>> 0));
  }
  return hosts;
}

function inferLocalSubnets() {
  const interfaces = os.networkInterfaces();
  const subnets = [];

  Object.values(interfaces).forEach(ifaceList => {
    (ifaceList || []).forEach(addr => {
      if (!addr || addr.internal || addr.family !== 'IPv4') return;
      if (!addr.address || !addr.netmask) return;

      const ip = ipToInt(addr.address);
      const mask = ipToInt(addr.netmask);
      const network = ip & mask;

      const prefix = addr.netmask
        .split('.')
        .map(n => Number(n).toString(2).padStart(8, '0'))
        .join('')
        .split('')
        .filter(bit => bit === '1').length;

      if (prefix >= 31 || prefix <= 0) return;
      subnets.push(`${intToIp(network)}/${prefix}`);
    });
  });

  return Array.from(new Set(subnets));
}

function gatherDiscoveryTargets(userSubnets = []) {
  let storedSubnets = [];

  try {
    const db = getDb();
    const raw = getSystemSetting(db, 'discovery_subnets', '');
    storedSubnets = String(raw || '')
      .split(/[\n,]/)
      .map(subnet => subnet.trim())
      .filter(Boolean);
  } catch (_) {
    storedSubnets = [];
  }

  const candidates = [
    ...(Array.isArray(userSubnets) ? userSubnets : []),
    ...storedSubnets,
    ...config.DISCOVERY_SUBNETS,
    ...inferLocalSubnets(),
  ];

  const normalized = Array.from(new Set(candidates.map(normalizeSubnetInput).filter(Boolean)));
  const targets = new Set();
  let remaining = config.DISCOVERY_MAX_HOSTS;

  normalized.forEach(cidr => {
    if (remaining <= 0) return;
    const hosts = expandCidrHosts(cidr, remaining);
    hosts.forEach(ip => targets.add(ip));
    remaining = Math.max(0, config.DISCOVERY_MAX_HOSTS - targets.size);
  });

  return Array.from(targets);
}

function parseOnvifScopes(rawScopes = '') {
  const prefix = 'onvif://www.onvif.org/';
  const scopeMap = {};

  rawScopes
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .forEach(scope => {
      const decoded = safeDecode(scope);
      if (!decoded.toLowerCase().startsWith(prefix)) return;

      const path = decoded.slice(prefix.length);
      const [rawKey, ...valueParts] = path.split('/');
      const key = (rawKey || '').toLowerCase();
      const value = valueParts.join('/').replace(/_/g, ' ').trim();
      if (!key || !value) return;

      if (!scopeMap[key]) scopeMap[key] = [];
      scopeMap[key].push(value);
    });

  return scopeMap;
}

function firstScope(scopeMap, key) {
  return scopeMap[key]?.[0] || '';
}

function inferManufacturer(explicitManufacturer, ...candidates) {
  if (explicitManufacturer && !/^unknown$/i.test(explicitManufacturer)) {
    return explicitManufacturer.trim();
  }

  const haystack = candidates.filter(Boolean).join(' ').toLowerCase();
  for (const m of MANUFACTURER_PATTERNS) {
    if (m.pattern.test(haystack)) return m.name;
  }
  return 'Unknown';
}

function inferCameraStyle(...candidates) {
  const haystack = candidates.filter(Boolean).join(' ').toLowerCase();
  for (const rule of STYLE_RULES) {
    if (rule.pattern.test(haystack)) return rule.style;
  }
  return 'Standard IP';
}

function inferDeviceType(scopeTypes = [], rawTypes = '') {
  const haystack = [...scopeTypes, rawTypes].join(' ').toLowerCase();
  if (/nvr|recorder/.test(haystack)) return 'Recorder';
  if (/video[_\s-]?encoder/.test(haystack)) return 'Video Encoder';
  if (/ptz/.test(haystack)) return 'PTZ Camera';
  return 'IP Camera';
}

function buildSuggestedRtsp(ip, manufacturer) {
  const m = (manufacturer || '').toLowerCase();
  if (m.includes('avigilon')) {
    return `rtsp://${ip}:554/defaultPrimary?streamType=u`;
  }
  if (m.includes('axis')) {
    return `rtsp://${ip}/axis-media/media.amp`;
  }
  if (m.includes('hikvision')) {
    return `rtsp://${ip}:554/Streaming/Channels/101`;
  }
  if (m.includes('dahua') || m.includes('amcrest')) {
    return `rtsp://${ip}:554/cam/realmonitor?channel=1&subtype=0`;
  }
  if (m.includes('hanwha') || m.includes('wisenet')) {
    return `rtsp://${ip}:554/profile2/media.smp`;
  }
  return `rtsp://${ip}:554/stream1`;
}

function profileMatch(manufacturer) {
  const isAvigilon = /^avigilon$/i.test(manufacturer || '');
  const isAvigilonLike = isAvigilon || AVIGILON_ALIKE_MANUFACTURERS.has(manufacturer || '');
  if (isAvigilon) {
    return { isAvigilon, isAvigilonLike, label: 'Avigilon', confidence: 'high' };
  }
  if (isAvigilonLike) {
    return { isAvigilon, isAvigilonLike, label: 'Avigilon-like', confidence: 'medium' };
  }
  return { isAvigilon, isAvigilonLike, label: 'Other ONVIF', confidence: 'low' };
}

function confidenceRank(value) {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
}

function enrichDevice(baseDevice, rawScopes = '', rawTypes = '') {
  const scopeMap = parseOnvifScopes(rawScopes);
  const scopeName = firstScope(scopeMap, 'name');
  const scopeHardware = firstScope(scopeMap, 'hardware');
  const scopeLocation = firstScope(scopeMap, 'location');
  const scopeTypes = scopeMap.type || [];

  const manufacturer = inferManufacturer(
    baseDevice.manufacturer,
    baseDevice.model,
    scopeName,
    scopeHardware,
    rawScopes,
    rawTypes,
    baseDevice.onvif_url
  );

  const model =
    (baseDevice.model && baseDevice.model !== 'IP Camera')
      ? baseDevice.model
      : (scopeHardware || scopeName || 'IP Camera');

  const cameraStyle = inferCameraStyle(model, scopeName, scopeHardware, scopeTypes.join(' '), rawTypes);
  const deviceType = inferDeviceType(scopeTypes, rawTypes);
  const profile = profileMatch(manufacturer);

  return {
    ...baseDevice,
    manufacturer,
    model,
    camera_style: cameraStyle,
    device_type: deviceType,
    scope_name: scopeName || null,
    scope_hardware: scopeHardware || null,
    scope_location: scopeLocation || null,
    onvif_types: scopeTypes,
    is_avigilon: profile.isAvigilon,
    is_avigilon_like: profile.isAvigilonLike,
    profile_label: profile.label,
    match_confidence: profile.confidence,
    suggested_rtsp: buildSuggestedRtsp(baseDevice.ip, manufacturer),
  };
}

function mergeDevices(existing, incoming) {
  const mergedTypes = Array.from(new Set([...(existing.onvif_types || []), ...(incoming.onvif_types || [])]));
  const best = confidenceRank(incoming.match_confidence) > confidenceRank(existing.match_confidence)
    ? incoming
    : existing;

  return {
    ...existing,
    ...incoming,
    ...best,
    manufacturer: existing.manufacturer !== 'Unknown' ? existing.manufacturer : incoming.manufacturer,
    model: existing.model !== 'IP Camera' ? existing.model : incoming.model,
    onvif_types: mergedTypes,
  };
}

const WS_DISCOVERY_PROBE = `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
            xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:${Date.now()}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`;

/**
 * Performs ONVIF WS-Discovery probe on the local network.
 * Returns an array of discovered device info objects.
 */
function discoverOnvif(timeout = config.ONVIF_DISCOVERY_TIMEOUT, unicastTargets = []) {
  return new Promise((resolve) => {
    const devices = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.bind(() => {
      socket.setBroadcast(true);
      try {
        socket.addMembership(ONVIF_MULTICAST_ADDR);
      } catch (_) {
        // May fail if not available — continue anyway
      }

      const msg = Buffer.from(WS_DISCOVERY_PROBE);
      socket.send(msg, 0, msg.length, ONVIF_PORT, ONVIF_MULTICAST_ADDR);

      // Fallback: unicast probe common camera hosts when multicast is blocked.
      unicastTargets.forEach(ip => {
        socket.send(msg, 0, msg.length, ONVIF_PORT, ip);
      });
    });

    socket.on('message', (msg) => {
      const text = msg.toString();
      const xAddrs = extractTagValue(text, 'XAddrs');
      const manufacturer = extractTagValue(text, 'Manufacturer');
      const model = extractTagValue(text, 'Model');
      const rawScopes = extractTagValue(text, 'Scopes');
      const rawTypes = extractTagValue(text, 'Types');

      if (xAddrs) {
        const xaddrs = xAddrs.split(/\s+/);
        xaddrs.forEach(addr => {
          if (addr.startsWith('http')) {
            let url;
            try {
              url = new URL(addr);
            } catch (_) {
              return;
            }

            if (!url.hostname) return;
            const key = url.hostname;
            const baseDevice = {
              ip: url.hostname,
              onvif_url: addr,
              manufacturer: manufacturer || 'Unknown',
              model: model || 'IP Camera',
              protocol: 'ONVIF',
              suggested_rtsp: `rtsp://${url.hostname}:554/stream1`,
              port: 554,
              onvif_port: parseInt(url.port, 10) || 80,
            };

            const enriched = enrichDevice(baseDevice, rawScopes, rawTypes);
            if (!devices.has(key)) {
              devices.set(key, enriched);
            } else {
              devices.set(key, mergeDevices(devices.get(key), enriched));
            }
          }
        });
      }
    });

    socket.on('error', () => {});

    setTimeout(() => {
      try { socket.close(); } catch (_) {}
      const sorted = Array.from(devices.values()).sort((a, b) => {
        const confidenceDiff = confidenceRank(b.match_confidence) - confidenceRank(a.match_confidence);
        if (confidenceDiff !== 0) return confidenceDiff;
        const mDiff = (a.manufacturer || '').localeCompare(b.manufacturer || '');
        if (mDiff !== 0) return mDiff;
        return (a.ip || '').localeCompare(b.ip || '', undefined, { numeric: true, sensitivity: 'base' });
      });
      resolve(sorted);
    }, timeout);
  });
}

async function probeRtspFallback(targetIps = []) {
  const found = [];
  const concurrency = 40;
  const queue = [...targetIps];

  const worker = async () => {
    while (queue.length > 0) {
      const ip = queue.shift();
      if (!ip) break;

      const reachable = await probeRtspPort(ip, 554, config.NETWORK_SCAN_TIMEOUT);
      if (!reachable) continue;

      found.push({
        ip,
        onvif_url: null,
        manufacturer: 'Unknown',
        model: 'IP Camera (RTSP detected)',
        protocol: 'RTSP',
        suggested_rtsp: `rtsp://${ip}:554/stream1`,
        port: 554,
        onvif_port: null,
        camera_style: 'Standard IP',
        device_type: 'IP Camera',
        scope_name: null,
        scope_hardware: null,
        scope_location: null,
        onvif_types: [],
        is_avigilon: false,
        is_avigilon_like: false,
        profile_label: 'RTSP only',
        match_confidence: 'low',
      });
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return found;
}

/**
 * Probe common RTSP ports on an IP to check if a camera is present.
 */
function probeRtspPort(ip, port = 554, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    socket.setTimeout(timeout);
    socket.connect(port, ip, () => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve(true);
      }
    });
    socket.on('timeout', () => {
      if (!done) { done = true; socket.destroy(); resolve(false); }
    });
    socket.on('error', () => {
      if (!done) { done = true; resolve(false); }
    });
  });
}

/**
 * Main discovery function — runs ONVIF discovery.
 */
async function discoverCameras(options = {}) {
  const targets = gatherDiscoveryTargets(options.subnets);
  console.log(`[Discovery] Starting ONVIF discovery (targets: ${targets.length})...`);

  const onvifDevices = await discoverOnvif(config.ONVIF_DISCOVERY_TIMEOUT, targets);
  console.log(`[Discovery] Found ${onvifDevices.length} ONVIF device(s)`);

  if (onvifDevices.length > 0 || targets.length === 0) {
    return onvifDevices;
  }

  console.log('[Discovery] Multicast/ONVIF response empty, running RTSP fallback scan...');
  const rtspDevices = await probeRtspFallback(targets);
  console.log(`[Discovery] RTSP fallback found ${rtspDevices.length} host(s)`);
  return rtspDevices;
}

module.exports = { discoverCameras, probeRtspPort };
