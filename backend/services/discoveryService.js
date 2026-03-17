/**
 * Camera Discovery Service
 * Discovers IP cameras on the local network via ONVIF WS-Discovery
 * and direct RTSP probing.
 */
const dgram = require('dgram');
const net = require('net');
const config = require('../config/config');

// ONVIF WS-Discovery multicast
const ONVIF_MULTICAST_ADDR = '239.255.255.250';
const ONVIF_PORT = 3702;

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
function discoverOnvif(timeout = config.ONVIF_DISCOVERY_TIMEOUT) {
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
    });

    socket.on('message', (msg) => {
      const text = msg.toString();
      const addressMatch = text.match(/XAddrs[^>]*>([^<]+)</i);
      const manufacturerMatch = text.match(/Manufacturer[^>]*>([^<]+)</i);
      const modelMatch = text.match(/Model[^>]*>([^<]+)</i);

      if (addressMatch) {
        const xaddrs = addressMatch[1].trim().split(/\s+/);
        xaddrs.forEach(addr => {
          if (addr.startsWith('http')) {
            const url = new URL(addr);
            const key = url.hostname;
            if (!devices.has(key)) {
              devices.set(key, {
                ip: url.hostname,
                onvif_url: addr,
                manufacturer: manufacturerMatch ? manufacturerMatch[1].trim() : 'Unknown',
                model: modelMatch ? modelMatch[1].trim() : 'IP Camera',
                protocol: 'ONVIF',
                suggested_rtsp: `rtsp://${url.hostname}:554/stream1`,
                port: 554,
                onvif_port: parseInt(url.port) || 80,
              });
            }
          }
        });
      }
    });

    socket.on('error', () => {});

    setTimeout(() => {
      try { socket.close(); } catch (_) {}
      resolve(Array.from(devices.values()));
    }, timeout);
  });
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
async function discoverCameras() {
  console.log('[Discovery] Starting ONVIF discovery...');
  const onvifDevices = await discoverOnvif();
  console.log(`[Discovery] Found ${onvifDevices.length} ONVIF device(s)`);
  return onvifDevices;
}

module.exports = { discoverCameras, probeRtspPort };
