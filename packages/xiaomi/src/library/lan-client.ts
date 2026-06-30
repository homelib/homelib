/**
 * Xiaomi MIoT LAN direct control client.
 *
 * Communicates directly with WiFi-enabled Xiaomi devices on the local network
 * using the OT (occur/time) protocol over UDP port 54321. This bypasses both
 * the cloud and the central hub gateway.
 *
 * Packet format:
 *   [0:2]   0x2131 (magic header)
 *   [2:4]   total data length (uint16 big-endian)
 *   [4:12]  device DID (uint64 big-endian)
 *   [12:16] time offset (uint32 big-endian)
 *   [16:32] MD5 checksum (computed with token in place of MD5)
 *   [32:]   AES-128-CBC encrypted JSON payload
 *
 * Encryption:
 *   aes_key = MD5(token)
 *   aes_iv  = MD5(aes_key + token)
 *   payload = AES-128-CBC(JSON, aes_key, aes_iv) with PKCS7 padding
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomInt,
} from 'node:crypto';
import {type RemoteInfo, type Socket, createSocket} from 'node:dgram';

export type LanClientOptions = {
  /** Device DID. */
  did: string;
  /** Device token (hex string, 32 chars = 16 bytes). */
  token: string;
  /** Device IP address. */
  ip: string;
  /** UDP port (default 54321). */
  port?: number;
  /** Local interface IP to bind to (optional). */
  localAddress?: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const OT_HEADER = 0x2131;
const OT_HEADER_LEN = 32;
const OT_PORT = 54321;

export class XiaomiLanClient {
  private readonly did: string;
  private readonly token: Buffer;
  private readonly aesKey: Buffer;
  private readonly aesIv: Buffer;
  private readonly ip: string;
  private readonly port: number;
  private socket: Socket | null = null;
  private msgIdCounter: number;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  /** Device uptime (seconds), synced from probe response. */
  private deviceTime = 0;

  constructor(options: LanClientOptions) {
    this.did = options.did;
    this.token = Buffer.from(options.token, 'hex');
    this.aesKey = createHash('md5').update(this.token).digest();
    this.aesIv = createHash('md5')
      .update(Buffer.concat([this.aesKey, this.token]))
      .digest();
    this.ip = options.ip;
    this.port = options.port ?? OT_PORT;
    this.msgIdCounter = randomInt(1, 0x7fffffff);
  }

  /** Initialize the UDP socket and start listening for responses. */
  async init(): Promise<void> {
    this.socket = createSocket({
      type: 'udp4',
      reuseAddr: true,
    });

    this.socket.on('message', (msg, rinfo) => {
      this.onMessage(msg, rinfo);
    });

    return new Promise((resolve, reject) => {
      this.socket!.on('error', reject);
      this.socket!.bind(() => resolve());
    });
  }

  /** Close the socket and clean up. */
  async close(): Promise<void> {
    for (const req of this.pendingRequests.values()) {
      clearTimeout(req.timer);
      req.reject(new Error('Closed'));
    }
    this.pendingRequests.clear();

    return new Promise(resolve => {
      if (this.socket) {
        this.socket.close(() => resolve());
        this.socket = null;
      } else {
        resolve();
      }
    });
  }

  /** Whether the device has been subscribed (required before API calls). */
  private subscribed = false;

  /**
   * Subscribe to the device. Required before sending API commands.
   * Sends a `miIO.sub` message so the device knows to ack our requests.
   */
  async subscribe(timeoutMs: number = 5_000): Promise<boolean> {
    if (this.subscribed) return true;

    const result = await this.callApi({
      method: 'miIO.sub',
      params: {
        version: '2.0',
        did: String(randomInt(0, 0x7fffffff)),
        update_ts: Math.floor(Date.now() / 1000),
        sub_method: '.',
      },
    }, timeoutMs);

    if (result && typeof result === 'object') {
      this.subscribed = true;
    }
    return this.subscribed;
  }

  /** Get a device property. */
  async getProp(
    did: string,
    siid: number,
    piid: number,
    timeoutMs: number = 10_000,
  ): Promise<unknown> {
    const result = await this.callApi(
      {
        method: 'get_properties',
        params: [{did, siid, piid}],
      },
      timeoutMs,
    );

    if (
      result &&
      typeof result === 'object' &&
      'result' in result &&
      Array.isArray((result as Record<string, unknown>).result) &&
      (result as Record<string, unknown[]>).result.length > 0
    ) {
      return (result as Record<string, unknown[]>).result[0];
    }
    return null;
  }

  /** Set a device property. */
  async setProp(
    did: string,
    siid: number,
    piid: number,
    value: unknown,
    timeoutMs: number = 10_000,
  ): Promise<Record<string, unknown>> {
    const result = await this.callApi(
      {
        method: 'set_properties',
        params: [{did, siid, piid, value}],
      },
      timeoutMs,
    );

    if (
      result &&
      typeof result === 'object' &&
      'result' in result &&
      Array.isArray((result as Record<string, unknown>).result) &&
      (result as Record<string, unknown[]>).result.length > 0
    ) {
      return (result as Record<string, unknown[]>).result[0] as Record<
        string,
        unknown
      >;
    }
    return {code: -1, message: 'Invalid result'};
  }

  /** Call a device action. */
  async action(
    did: string,
    siid: number,
    aiid: number,
    inList: unknown[],
    timeoutMs: number = 10_000,
  ): Promise<Record<string, unknown>> {
    const result = await this.callApi(
      {
        method: 'action',
        params: {did, siid, aiid, in: inList},
      },
      timeoutMs,
    );

    if (result && typeof result === 'object') {
      return result as Record<string, unknown>;
    }
    return {code: -1, message: 'Invalid result'};
  }

  /** Send a probe packet to discover the device and sync time offset. */
  async probe(timeoutMs: number = 5_000): Promise<boolean> {
    if (!this.socket) throw new Error('Not initialized');

    // Probe uses a random virtual DID (not the target device DID),
    // matching the Python ha_xiaomi_home implementation.
    const virtualDid = BigInt(randomInt(0, 0x7fffffff));
    const probe = Buffer.alloc(32);
    probe[0] = 0x21;
    probe[1] = 0x31;
    probe[2] = 0x00;
    probe[3] = 0x20; // length = 32
    probe.fill(0xff, 4, 16);
    probe.write('MDID', 16, 4, 'ascii');
    probe.writeBigUInt64BE(virtualDid, 20);
    // bytes 28-31 are zero

    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(-1);
        resolve(false);
      }, timeoutMs);

      this.pendingRequests.set(-1, {
        resolve: () => {
          clearTimeout(timer);
          resolve(true);
        },
        reject: () => resolve(false),
        timer,
      });

      this.socket!.send(probe, this.port, this.ip);
    });
  }

  private async callApi(
    msg: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    if (!this.socket) throw new Error('Not initialized');

    const msgId = this.nextMsgId();
    const fullMsg = {id: msgId, from: 'ha.homelib', ...msg};
    const payload = this.encryptPayload(fullMsg);
    const packet = this.buildPacket(msgId, payload);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(msgId);
        reject(new Error(`Request timed out (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingRequests.set(msgId, {resolve, reject, timer});
      this.socket!.send(packet, this.port, this.ip);
    });
  }

  private nextMsgId(): number {
    this.msgIdCounter++;
    if (this.msgIdCounter > 0x7fffffff) {
      this.msgIdCounter = 1;
    }
    return this.msgIdCounter;
  }

  private encryptPayload(data: Record<string, unknown>): Buffer {
    const json = JSON.stringify(data);
    const plaintext = Buffer.from(json, 'utf-8');

    // PKCS7 padding
    const blockSize = 16;
    const padLen = blockSize - (plaintext.length % blockSize);
    const padded = Buffer.concat([plaintext, Buffer.alloc(padLen, padLen)]);

    const cipher = createCipheriv('aes-128-cbc', this.aesKey, this.aesIv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(padded), cipher.final()]);
  }

  private decryptPayload(encrypted: Buffer): Record<string, unknown> {
    const decipher = createDecipheriv('aes-128-cbc', this.aesKey, this.aesIv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    // Strip PKCS7 padding and trailing nulls
    let end = decrypted.length;
    if (end > 0) {
      const padLen = decrypted[end - 1];
      if (padLen > 0 && padLen <= 16) {
        end -= padLen;
      }
    }
    // Also strip trailing \x00 that some devices add
    while (end > 0 && decrypted[end - 1] === 0) {
      end--;
    }

    const json = decrypted.subarray(0, end).toString('utf-8');
    return JSON.parse(json);
  }

  private buildPacket(msgId: number, encryptedPayload: Buffer): Buffer {
    const dataLen = OT_HEADER_LEN + encryptedPayload.length;
    const packet = Buffer.alloc(dataLen);

    // Header: magic(2) + length(2) + did(8) + offset(4) + token(16)
    packet.writeUInt16BE(OT_HEADER, 0);
    packet.writeUInt16BE(dataLen, 2);
    packet.writeBigUInt64BE(BigInt(this.did), 4);
    packet.writeUInt32BE(this.deviceTime, 12);
    this.token.copy(packet, 16, 0, 16);

    // Encrypted payload
    encryptedPayload.copy(packet, 32);

    // Compute MD5 over [0:dataLen] with token in [16:32], then replace [16:32] with MD5
    const md5 = createHash('md5').update(packet.subarray(0, dataLen)).digest();
    md5.copy(packet, 16);

    return packet;
  }

  private onMessage(msg: Buffer, _rinfo: RemoteInfo): void {
    if (msg.length < OT_HEADER_LEN) return;
    if (msg.readUInt16BE(0) !== OT_HEADER) return;

    const dataLen = msg.readUInt16BE(2);
    if (msg.length < dataLen) return;

    // Probe / keep-alive response (32 bytes, no encrypted payload)
    if (dataLen === OT_HEADER_LEN) {
      const did = msg.readBigUInt64BE(4).toString();
      if (did === this.did) {
        // Sync device time (uptime in seconds) from probe response
        this.deviceTime = msg.readUInt32BE(12);

        const pending = this.pendingRequests.get(-1);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(-1);
          pending.resolve(true);
        }
      }
      return;
    }

    // Encrypted API response (dataLen > 32)
    // Verify MD5
    const md5Orig = msg.subarray(16, 32);
    const msgCopy = Buffer.from(msg.subarray(0, dataLen));
    this.token.copy(msgCopy, 16, 0, 16);
    const md5Calc = createHash('md5').update(msgCopy).digest();
    if (!md5Orig.equals(md5Calc)) return;

    // Decrypt payload
    const encrypted = msg.subarray(32, dataLen);
    try {
      const result = this.decryptPayload(encrypted);

      // Handle API response
      const id = (result as Record<string, unknown>).id as number | undefined;
      if (id !== undefined) {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(id);
          pending.resolve(result);
        }
      }
    } catch {
      // ignore decryption errors
    }
  }
}
