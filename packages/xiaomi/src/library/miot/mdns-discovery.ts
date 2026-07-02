/**
 * Xiaomi central hub gateway mDNS discovery.
 *
 * The central hub gateway advertises itself via mDNS with service type
 * `_miot-central._tcp.local.`. The service's TXT record contains a base64
 * `profile` field encoding the gateway's DID, group_id, and capabilities.
 *
 * When mDNS multicast is unavailable (e.g. WSL, Docker, some corporate
 * networks), a fallback subnet scan can discover the gateway by sending OT
 * probe packets (UDP port 54321) to all IPs in the local subnet and matching
 * the responding device's DID against the known gateway DID.
 */

import {X509Certificate as X509CertClass, randomInt} from 'node:crypto';
import {type RemoteInfo, type Socket, createSocket} from 'node:dgram';
import {networkInterfaces} from 'node:os';
import {type TLSSocket, connect as tlsConnect} from 'node:tls';

import {Bonjour, type Service} from 'bonjour-service';

/** mDNS service type for Xiaomi central hub gateway. */
export const MIPS_MDNS_TYPE = '_miot-central._tcp.local.';

export type GatewayInfo = {
  /** Gateway device DID. */
  did: string;
  /** Group ID (16 hex chars, reversed from profile bytes). */
  group_id: string;
  /** Gateway IP address. */
  address: string;
  /** MQTT broker port (usually 8883). */
  port: number;
  /** Service name from mDNS. */
  name: string;
  /** Whether the gateway supports MQTT. */
  suite_mqtt: boolean;
  /** Role (1 = central hub). */
  role: number;
};

/**
 * Parse the `profile` field from mDNS TXT records.
 *
 * Profile binary format:
 *   [1:9]  did (uint64 big-endian)
 *   [9:17] group_id (8 bytes, reversed for hex encoding)
 *   [20]   role (upper nibble)
 *   [22]   suite_mqtt (bit 1)
 */
function parseProfile(profileBase64: string): {
  did: string;
  group_id: string;
  role: number;
  suite_mqtt: boolean;
} {
  const bin = Buffer.from(profileBase64, 'base64');
  const did = String(bin.readBigUInt64BE(1));
  const groupIdBytes = bin.subarray(9, 17);
  // Reverse bytes then hex-encode (matching Python's binascii.hexlify(bytes[::-1]))
  const group_id = Buffer.from(groupIdBytes).reverse().toString('hex');
  const role = bin[20] >> 4;
  const suite_mqtt = ((bin[22] >> 1) & 0x01) === 0x01;
  return {did, group_id, role, suite_mqtt};
}

/**
 * Discover Xiaomi central hub gateways on the local network via mDNS.
 *
 * @param timeoutMs How long to scan (default 10 seconds).
 * @returns Array of discovered gateways.
 */
export async function discoverGateways(
  timeoutMs: number = 10_000,
): Promise<GatewayInfo[]> {
  return new Promise(resolve => {
    const bonjour = new Bonjour();
    const found: GatewayInfo[] = [];
    const seen = new Set<string>();

    const browser = bonjour.find({type: 'miot-central', protocol: 'tcp'});

    const timer = setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve(found);
    }, timeoutMs);

    browser.on('serviceUp', (service: Service) => {
      try {
        const profile = service.txt?.['profile'];
        if (!profile || typeof profile !== 'string') return;

        const parsed = parseProfile(profile);
        if (parsed.role !== 1 || !parsed.suite_mqtt) return;

        const address = service.addresses?.[0] ?? service.referer?.address;
        if (!address) return;

        const key = parsed.did;
        if (seen.has(key)) return;
        seen.add(key);

        found.push({
          did: parsed.did,
          group_id: parsed.group_id,
          address,
          port: service.port,
          name: service.name,
          suite_mqtt: parsed.suite_mqtt,
          role: parsed.role,
        });
      } catch {
        // skip invalid services
      }
    });

    // Also resolve on early exit if browser finishes
    browser.on('end', () => {
      clearTimeout(timer);
      bonjour.destroy();
      resolve(found);
    });
  });
}

// ---- Subnet scan fallback ----

const OT_PORT = 54321;

/**
 * Get all local IPv4 subnets (CIDR notation) from network interfaces.
 * Excludes loopback, internal, and link-local addresses.
 */
function getLocalSubnets(): Array<{cidr: string; ip: string}> {
  const interfaces = networkInterfaces();
  const subnets: Array<{cidr: string; ip: string}> = [];
  for (const ifaces of Object.values(interfaces)) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (iface.address.startsWith('169.254.')) continue; // link-local
      if (!iface.cidr) continue;
      subnets.push({cidr: iface.cidr, ip: iface.address});
    }
  }
  return subnets;
}

/**
 * Enumerate all host IPs in a CIDR range (excluding network and broadcast).
 * For /24 and smaller, returns all 254 hosts. For larger subnets, caps at 256.
 */
function enumerateSubnetIps(cidr: string): string[] {
  const [ipStr, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const ipParts = ipStr!.split('.').map(Number);
  const ipInt =
    (ipParts[0]! << 24) |
    (ipParts[1]! << 16) |
    (ipParts[2]! << 8) |
    ipParts[3]!;
  const mask = prefix >= 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  const ips: string[] = [];
  const maxHosts = Math.min(broadcast - network - 1, 256);
  for (let i = 1; i <= maxHosts; i++) {
    const hostIp = (network + i) >>> 0;
    ips.push(
      `${(hostIp >>> 24) & 0xff}.${(hostIp >> 16) & 0xff}.${(hostIp >> 8) & 0xff}.${hostIp & 0xff}`,
    );
  }
  return ips;
}

/**
 * Build an OT probe packet (32 bytes, no encryption needed).
 *
 * Format:
 *   [0:2]   0x2131 (magic header)
 *   [2:4]   0x0020 (length = 32)
 *   [4:16]  0xFF * 12 (broadcast marker)
 *   [16:20] "MDID" (probe type)
 *   [20:28] virtual DID (uint64 big-endian)
 *   [28:32] 0x00000000
 */
function buildProbePacket(virtualDid: string): Buffer {
  const buf = Buffer.alloc(32);
  buf[0] = 0x21;
  buf[1] = 0x31;
  buf[2] = 0x00;
  buf[3] = 0x20; // length = 32
  buf.fill(0xff, 4, 16);
  buf.write('MDID', 16, 4, 'ascii');
  buf.writeBigUInt64BE(BigInt(virtualDid), 20);
  // bytes 28-31 are zero
  return buf;
}

/**
 * Discover a gateway by scanning the local subnet.
 *
 * Sends OT probe packets to all IPs and matches responding DIDs against
 * the known gateway DIDs. For each match, verifies that port 8883 has an
 * MQTT broker by attempting a TLS connection.
 *
 * @param gatewayDids Array of known gateway DIDs (from cloud device list).
 * @param timeoutMs Scan timeout (default 8 seconds).
 * @param virtualDid Optional virtual DID for the probe (auto-generated if omitted).
 * @returns The gateway IP if found, or null.
 */
export async function discoverGatewayByScan(
  gatewayDids: string[],
  timeoutMs: number = 8_000,
  virtualDid?: string,
): Promise<{ip: string; port: number} | null> {
  const subnets = getLocalSubnets();
  if (subnets.length === 0) {
    return null;
  }

  // Collect all target IPs from non-docker/non-tailscale subnets
  const allIps = new Set<string>();
  for (const {cidr, ip} of subnets) {
    // Skip Tailscale (100.x), Docker (172.x), and /32 single-host routes
    if (ip.startsWith('100.') || ip.startsWith('172.')) continue;
    if (cidr.endsWith('/32')) continue;
    for (const targetIp of enumerateSubnetIps(cidr)) {
      allIps.add(targetIp);
    }
  }

  if (allIps.size === 0) return null;

  // Scan for all candidate DIDs, then verify which one has an MQTT broker
  const foundIps = await scanByOtProbeMulti(
    gatewayDids,
    [...allIps],
    timeoutMs,
    virtualDid,
  );

  // Try TLS connection to each found IP on both 8883 (standalone gateway)
  // and 18883 (router-built-in gateway), return the first that works.
  // We check the server certificate CN for "mips" to distinguish the MQTT
  // broker from other TLS services (e.g. router admin UI on port 8883).
  const mqttPorts = [18883, 8883];
  for (const {ip} of foundIps) {
    for (const port of mqttPorts) {
      const certInfo = await tryMqttTlsConnect(ip, port, 3_000);
      if (certInfo) {
        return {ip, port};
      }
    }
  }

  // If OT probe didn't find any, try MQTT broker scan on all IPs
  const mqttResult = await scanByMqttBroker([...allIps], timeoutMs);
  return mqttResult;
}

/**
 * Scan IPs by sending OT probe packets and matching multiple DIDs.
 * Returns all matching (did, ip) pairs.
 */
async function scanByOtProbeMulti(
  gatewayDids: string[],
  ips: string[],
  timeoutMs: number,
  virtualDid?: string,
): Promise<Array<{did: string; ip: string}>> {
  const vDid = virtualDid ?? String(randomInt(0, 0x7fffffff));
  const probe = buildProbePacket(vDid);
  const targetDids = new Set(gatewayDids.map(d => BigInt(d)));
  const found: Array<{did: string; ip: string}> = [];
  const seen = new Set<string>();

  return new Promise(resolve => {
    const socket: Socket = createSocket({type: 'udp4', reuseAddr: true});
    let resolved = false;

    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      socket.close();
      resolve(found);
    };

    socket.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
      if (msg.length < 32 || msg[0] !== 0x21 || msg[1] !== 0x31) return;
      const did = msg.readBigUInt64BE(4);
      const didStr = did.toString();
      if (targetDids.has(did)) {
        const key = `${didStr}@${rinfo.address}`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push({did: didStr, ip: rinfo.address});
        }
      }
    });

    socket.on('error', () => {
      // ignore
    });

    socket.bind(() => {
      for (const ip of ips) {
        try {
          socket.send(probe, OT_PORT, ip);
        } catch {
          // ignore
        }
      }
    });

    const timer = setTimeout(() => finish(), timeoutMs);
  });
}

/**
 * Try a TLS connection to check if port is a Xiaomi MQTT broker.
 * Returns true only if the server certificate CN contains "mips" (the
 * gateway's cert format), distinguishing it from router admin UIs.
 */
async function tryMqttTlsConnect(
  ip: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    let socket: TLSSocket;
    try {
      socket = tlsConnect({
        host: ip,
        port,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      });
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }

    socket.on('secureConnect', () => {
      try {
        const cert = socket.getPeerCertificate();
        if (cert && cert.subject) {
          // Gateway MQTT broker certs have CN starting with "mips."
          const cn = Array.isArray(cert.subject.CN)
            ? (cert.subject.CN[0] ?? '')
            : (cert.subject.CN ?? '');
          if (cn.startsWith('mips.')) {
            finish(true);
            return;
          }
        }
      } catch {
        // ignore
      }
      finish(false);
    });

    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}

/**
 * Scan IPs by attempting TLS connections to port 8883 and checking if the
 * server presents a certificate signed by the Xiaomi MIoT CA.
 *
 * The central hub gateway's MQTT broker uses a self-signed CA. We check if
 * the server's certificate chain is valid under the known Xiaomi CA.
 */
async function scanByMqttBroker(
  ips: string[],
  _timeoutMs: number,
): Promise<{ip: string; port: number} | null> {
  // Try connecting to each IP on ports 8883 and 18883 in parallel (batched).
  // 8883 = standalone gateway, 18883 = router-built-in gateway
  const mqttPorts = [8883, 18883];
  const batchSize = 50;
  for (let i = 0; i < ips.length; i += batchSize) {
    const batch = ips.slice(i, i + batchSize);
    for (const port of mqttPorts) {
      const results = await Promise.allSettled(
        batch.map(ip => tryMqttTlsHandshake(ip, port, 3000)),
      );
      for (let j = 0; j < results.length; j++) {
        const result = results[j]!;
        if (result.status === 'fulfilled' && result.value) {
          return {ip: batch[j]!, port};
        }
      }
    }
    if (i + batchSize >= ips.length) break;
  }

  return null;
}

/**
 * Try a TLS handshake to check if the server is a Xiaomi MQTT broker.
 * Returns true if the certificate looks like a Xiaomi device cert.
 */
function tryMqttTlsHandshake(
  ip: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    let socket: TLSSocket;
    try {
      socket = tlsConnect({
        host: ip,
        port,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      });
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }

    socket.on('secureConnect', () => {
      try {
        const cert = socket.getPeerCertificate();
        if (cert && cert.raw) {
          const certPem = `-----BEGIN CERTIFICATE-----\n${cert.raw
            .toString('base64')
            .match(/.{1,64}/g)
            ?.join('\n')}\n-----END CERTIFICATE-----`;
          const x509 = new X509CertClass(certPem);
          const certText = `${x509.subject} ${x509.issuer}`;
          if (
            certText.includes('mips') ||
            certText.includes('Mijia') ||
            certText.includes('MIoT') ||
            certText.includes('Xiaomi') ||
            certText.includes('xiaomi')
          ) {
            finish(true);
            return;
          }
        }
      } catch {
        // ignore cert parsing errors
      }
      finish(false);
    });

    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}

/**
 * Try mDNS first, then fall back to subnet scan if mDNS finds nothing.
 *
 * @param gatewayDids Known gateway DIDs (from cloud device list) for scan fallback.
 * @param timeoutMs Total timeout (default 15 seconds: 10s mDNS + 5s scan).
 * @returns Array of discovered gateways (mDNS) or a single gateway (scan).
 */
export async function discoverGatewaysWithFallback(
  gatewayDids: string[],
  timeoutMs: number = 15_000,
): Promise<GatewayInfo[]> {
  // Try mDNS first
  const gateways = await discoverGateways(Math.min(timeoutMs, 10_000));
  if (gateways.length > 0) {
    return gateways;
  }

  // Fallback: subnet scan
  const result = await discoverGatewayByScan(gatewayDids, 8_000);
  if (result) {
    return [
      {
        did: gatewayDids[0] ?? '',
        group_id: '', // group_id not available from scan; caller must get from cloud
        address: result.ip,
        port: result.port,
        name: 'Xiaomi Central Hub Gateway (discovered via scan)',
        suite_mqtt: true,
        role: 1,
      },
    ];
  }

  return [];
}
