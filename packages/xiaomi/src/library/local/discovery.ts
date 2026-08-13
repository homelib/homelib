import {X509Certificate, createHash} from 'node:crypto';
import {type RemoteInfo, createSocket} from 'node:dgram';
import {isIP} from 'node:net';
import {networkInterfaces} from 'node:os';
import {connect as connectTls} from 'node:tls';

import {Bonjour, type Service} from 'bonjour-service';

import {isMipsGatewayCertificate} from './certificate.js';

export {getVirtualDid} from './certificate.js';

const CENTRAL_SERVICE_TYPE = 'miot-central';
const DEFAULT_DISCOVERY_TIMEOUT = 5_000;
const UDP_DISCOVERY_PORT = 54_321;
const UDP_DISCOVERY_TIMEOUT = 1_500;
const TLS_PROBE_TIMEOUT = 1_500;
const MIPS_PORTS = [18_883, 8_883] as const;

export type CentralGatewayCandidate = {
  readonly did: string;
  readonly homeId: string;
  readonly homeName: string;
};

export type CentralRoute = {
  /** The DID that actually answered discovery, never a placeholder candidate. */
  readonly did: string;
  readonly groupId: string;
  readonly homeName: string;
  readonly address: string;
  readonly port: number;
};

export type CentralProfile = {
  readonly did: string;
  readonly groupId: string;
  readonly role: number;
  readonly suiteMqtt: boolean;
};

export type DiscoverCentralRoutesOptions = {
  readonly candidates: readonly CentralGatewayCandidate[];
  readonly userId: string;
  readonly virtualDid: string;
  readonly timeout?: number;
};

type DiscoveredEndpoint = {
  readonly did: string;
  readonly groupId: string;
  readonly homeName: string;
  readonly address: string;
};

export async function discoverCentralRoutes(
  options: DiscoverCentralRoutesOptions,
): Promise<readonly CentralRoute[]> {
  if (options.candidates.length === 0) {
    return [];
  }

  const candidates = new Map(
    options.candidates.map(candidate => [candidate.did, candidate]),
  );
  const timeout = normalizeTimeout(options.timeout);
  const mdnsEndpoints = await discoverMdnsEndpoints(candidates, timeout);
  const mdnsRoutes = await resolveMipsPorts(mdnsEndpoints);
  const remainingCandidates = new Map(candidates);

  for (const route of mdnsRoutes) {
    remainingCandidates.delete(route.did);
  }

  const udpMatches = await discoverUdpEndpoints(
    remainingCandidates,
    options.userId,
    options.virtualDid,
    Math.min(timeout, UDP_DISCOVERY_TIMEOUT),
  );

  const udpRoutes = await resolveMipsPorts(udpMatches);
  return [...mdnsRoutes, ...udpRoutes];
}

export function calcGroupId(
  userId: string | number,
  homeId: string | number,
): string {
  return createHash('sha1')
    .update(`${userId}central_service${homeId}`)
    .digest('hex')
    .slice(0, 16);
}

export function parseCentralProfile(
  encodedProfile: string,
): CentralProfile | undefined {
  if (
    encodedProfile.length === 0 ||
    !/^[A-Za-z\d+/]+={0,2}$/u.test(encodedProfile)
  ) {
    return undefined;
  }

  let profile: Buffer;

  try {
    profile = Buffer.from(encodedProfile, 'base64');
  } catch {
    return undefined;
  }

  if (profile.length < 23) {
    return undefined;
  }

  const did = profile.readBigUInt64BE(1).toString();
  const role = profile[20]! >> 4;
  const suiteMqtt = (profile[22]! & 0b10) !== 0;

  if (did === '0' || role !== 1 || !suiteMqtt) {
    return undefined;
  }

  return {
    did,
    groupId: Buffer.from(profile.subarray(9, 17)).reverse().toString('hex'),
    role,
    suiteMqtt,
  };
}

async function discoverMdnsEndpoints(
  candidates: ReadonlyMap<string, CentralGatewayCandidate>,
  timeout: number,
): Promise<readonly DiscoveredEndpoint[]> {
  return new Promise(resolve => {
    const endpoints = new Map<string, DiscoveredEndpoint>();
    const bonjour = new Bonjour(undefined, () => undefined);
    const browser = bonjour.find({type: CENTRAL_SERVICE_TYPE, protocol: 'tcp'});
    let settled = false;

    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      browser.stop();
      bonjour.destroy();
      resolve([...endpoints.values()]);
    };

    const timer = setTimeout(finish, timeout);

    browser.on('up', service => {
      const endpoint = readMdnsEndpoint(service, candidates);

      if (endpoint !== undefined) {
        endpoints.set(`${endpoint.did}@${endpoint.address}`, endpoint);
      }
    });
  });
}

function readMdnsEndpoint(
  service: Service,
  candidates: ReadonlyMap<string, CentralGatewayCandidate>,
): DiscoveredEndpoint | undefined {
  const encodedProfile = readProfile(service.txt?.profile);
  const profile =
    encodedProfile === undefined
      ? undefined
      : parseCentralProfile(encodedProfile);
  const candidate =
    profile === undefined ? undefined : candidates.get(profile.did);
  const address = service.addresses?.find(value => isIP(value) === 4);

  if (
    profile === undefined ||
    candidate === undefined ||
    address === undefined ||
    !Number.isSafeInteger(service.port) ||
    service.port < 1 ||
    service.port > 65_535
  ) {
    return undefined;
  }

  return {
    did: profile.did,
    groupId: profile.groupId,
    homeName: candidate.homeName,
    address,
  };
}

function readProfile(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  } else if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  return undefined;
}

async function discoverUdpEndpoints(
  candidates: ReadonlyMap<string, CentralGatewayCandidate>,
  userId: string,
  virtualDid: string,
  timeout: number,
): Promise<readonly DiscoveredEndpoint[]> {
  const matches = await probeUdpCandidates(candidates, virtualDid, timeout);

  return matches.map(match => {
    const candidate = candidates.get(match.did)!;

    return {
      did: match.did,
      groupId: calcGroupId(userId, candidate.homeId),
      homeName: candidate.homeName,
      address: match.address,
    };
  });
}

function probeUdpCandidates(
  candidates: ReadonlyMap<string, CentralGatewayCandidate>,
  virtualDid: string,
  timeout: number,
): Promise<readonly {readonly did: string; readonly address: string}[]> {
  const validCandidateDids = new Set(
    [...candidates.keys()].filter(isUnsigned64BitDecimal),
  );

  if (validCandidateDids.size === 0 || !isUnsigned64BitDecimal(virtualDid)) {
    return Promise.resolve([]);
  }

  return new Promise(resolve => {
    const socket = createSocket({type: 'udp4', reuseAddr: true});
    const matches = new Map<
      string,
      {readonly did: string; readonly address: string}
    >();
    let settled = false;

    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      try {
        socket.close();
      } catch {
        // Binding failures can emit error before the UDP socket starts.
      }

      resolve([...matches.values()]);
    };

    const timer = setTimeout(finish, timeout);

    socket.on('message', (message: Buffer, remote: RemoteInfo) => {
      const did = readUdpResponseDid(message);

      if (did !== undefined && validCandidateDids.has(did)) {
        matches.set(`${did}@${remote.address}`, {
          did,
          address: remote.address,
        });
      }
    });
    socket.on('error', finish);
    socket.bind(0, '0.0.0.0', () => {
      try {
        socket.setBroadcast(true);
      } catch {
        finish();
        return;
      }

      const packets = [createMiotHelloPacket(), createMdidPacket(virtualDid)];

      for (const address of getUdpProbeAddresses()) {
        for (const packet of packets) {
          socket.send(packet, UDP_DISCOVERY_PORT, address, () => undefined);
        }
      }
    });
  });
}

function readUdpResponseDid(message: Buffer): string | undefined {
  if (
    message.length < 12 ||
    message[0] !== 0x21 ||
    message[1] !== 0x31 ||
    message.readUInt16BE(2) > message.length
  ) {
    return undefined;
  }

  const did = message.readBigUInt64BE(4).toString();

  return did === '0' ? undefined : did;
}

function createMiotHelloPacket(): Buffer {
  const packet = Buffer.alloc(32, 0xff);

  packet.writeUInt16BE(0x2131, 0);
  packet.writeUInt16BE(32, 2);
  return packet;
}

function createMdidPacket(virtualDid: string): Buffer {
  const packet = Buffer.alloc(32);

  packet.writeUInt16BE(0x2131, 0);
  packet.writeUInt16BE(32, 2);
  packet.fill(0xff, 4, 16);
  packet.write('MDID', 16, 'ascii');
  packet.writeBigUInt64BE(BigInt(virtualDid), 20);
  return packet;
}

function getUdpProbeAddresses(): readonly string[] {
  const addresses = new Set<string>(['255.255.255.255']);

  for (const records of Object.values(networkInterfaces())) {
    for (const record of records ?? []) {
      if (record.family !== 'IPv4' || record.internal) {
        continue;
      }

      const address = ipv4ToInteger(record.address);
      const mask = ipv4ToInteger(record.netmask);

      if (address === undefined || mask === undefined) {
        continue;
      }

      addresses.add(integerToIpv4((address | ~mask) >>> 0));

      // Unicast probes make discovery work on networks that filter broadcasts.
      // Keep it bounded to the current /24 even when a virtual interface has a
      // much larger prefix.
      const classCNetwork = address & 0xffffff00;

      for (let host = 1; host < 255; host += 1) {
        addresses.add(integerToIpv4((classCNetwork | host) >>> 0));
      }
    }
  }

  return [...addresses];
}

async function resolveMipsPorts(
  endpoints: readonly DiscoveredEndpoint[],
): Promise<readonly CentralRoute[]> {
  const unresolved = new Map(
    endpoints.map(endpoint => [
      `${endpoint.did}@${endpoint.address}`,
      endpoint,
    ]),
  );
  const routes: CentralRoute[] = [];

  for (const port of MIPS_PORTS) {
    const probes = await Promise.all(
      [...unresolved.entries()].map(async ([key, endpoint]) => ({
        key,
        endpoint,
        valid: await hasMipsTlsCertificate(
          endpoint.address,
          port,
          endpoint.did,
        ),
      })),
    );

    for (const probe of probes) {
      if (!probe.valid) {
        continue;
      }

      unresolved.delete(probe.key);
      routes.push({...probe.endpoint, port});
    }
  }

  return routes;
}

function hasMipsTlsCertificate(
  address: string,
  port: number,
  gatewayDid: string,
): Promise<boolean> {
  return new Promise(resolve => {
    // Discovery has no client credential yet, so this deliberately performs an
    // unauthenticated probe and only inspects the peer identity. The actual
    // MQTT connection validates the CA and supplies the client certificate.
    const socket = connectTls({
      host: address,
      port,
      rejectUnauthorized: false,
    });
    let settled = false;

    const finish = (result: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), TLS_PROBE_TIMEOUT);

    socket.once('secureConnect', () => {
      try {
        const peer = socket.getPeerCertificate();
        const certificate =
          peer.raw === undefined ? undefined : new X509Certificate(peer.raw);

        finish(
          certificate !== undefined &&
            isMipsGatewayCertificate(certificate, gatewayDid),
        );
      } catch {
        finish(false);
      }
    });
    socket.once('error', () => finish(false));
  });
}

function normalizeTimeout(timeout: number | undefined): number {
  if (timeout === undefined) {
    return DEFAULT_DISCOVERY_TIMEOUT;
  } else if (!Number.isFinite(timeout) || timeout < 0) {
    throw new TypeError('Local MQTT discovery timeout must be non-negative.');
  }

  return timeout;
}

function isUnsigned64BitDecimal(value: string): boolean {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    return false;
  }

  const integer = BigInt(value);

  return integer <= BigInt('18446744073709551615');
}

function ipv4ToInteger(address: string): number | undefined {
  if (isIP(address) !== 4) {
    return undefined;
  }

  return address
    .split('.')
    .map(Number)
    .reduce((value, octet) => ((value << 8) | octet) >>> 0, 0);
}

function integerToIpv4(value: number): string {
  return [24, 16, 8, 0]
    .map(offset => String((value >>> offset) & 0xff))
    .join('.');
}
