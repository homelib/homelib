/**
 * Xiaomi MIoT local MQTT client for central hub gateway control.
 *
 * Connects to a Xiaomi central hub gateway's MQTT broker via mutual TLS
 * (mTLS) using a user certificate obtained from the cloud API. Unlike the
 * cloud MQTT client, the local client can send control commands (get/set
 * properties, actions) directly through the gateway without going through
 * Xiaomi Cloud.
 *
 * Message format: The local broker uses a custom binary framing on top of
 * MQTT payloads (see `MipsMessage`). Each message contains a message ID,
 * optional return topic, optional source, and a JSON payload string.
 */

import {randomInt} from 'node:crypto';
import {readFileSync} from 'node:fs';

import {type MqttClient, connect} from 'mqtt';

export type LocalMqttClientOptions = {
  /** Virtual DID (random 64-bit number, used as MQTT client ID). */
  did: string;
  /** Gateway IP address. */
  host: string;
  /** Gateway MQTT port (usually 8883). */
  port?: number;
  /** CA certificate file path. */
  caFile: string;
  /** User certificate file path. */
  certFile: string;
  /** User private key file path. */
  keyFile: string;
  /** Home/group name for logging. */
  homeName?: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * Pack a MIPS binary message.
 *
 * Format: sequence of TLV entries, each: [len:uint32_le][type:uint8][data]
 * Types: 0=ID(uint32_le), 1=RET_TOPIC(string\0), 2=PAYLOAD(string\0), 3=FROM(string\0)
 */
function packMipsMessage(
  mid: number,
  payload: string,
  msgFrom?: string,
  retTopic?: string,
): Buffer {
  const parts: Buffer[] = [];

  // mid (type 0, 4 bytes)
  parts.push(Buffer.from([4, 0, 0, 0, 0])); // len=4, type=0
  const midBuf = Buffer.alloc(4);
  midBuf.writeUInt32LE(mid, 0);
  parts.push(midBuf);

  // msg_from (type 3)
  if (msgFrom) {
    const data = Buffer.from(msgFrom, 'utf-8');
    const header = Buffer.alloc(5);
    header.writeUInt32LE(data.length + 1, 0); // +1 for null terminator
    header[4] = 3;
    parts.push(header, data, Buffer.from([0]));
  }

  // ret_topic (type 1)
  if (retTopic) {
    const data = Buffer.from(retTopic, 'utf-8');
    const header = Buffer.alloc(5);
    header.writeUInt32LE(data.length + 1, 0);
    header[4] = 1;
    parts.push(header, data, Buffer.from([0]));
  }

  // payload (type 2)
  const payloadData = Buffer.from(payload, 'utf-8');
  const payloadHeader = Buffer.alloc(5);
  payloadHeader.writeUInt32LE(payloadData.length + 1, 0);
  payloadHeader[4] = 2;
  parts.push(payloadHeader, payloadData, Buffer.from([0]));

  return Buffer.concat(parts);
}

/** Unpack a MIPS binary message. */
function unpackMipsMessage(data: Buffer): {
  mid: number;
  retTopic?: string;
  payload?: string;
  msgFrom?: string;
} {
  let offset = 0;
  const result: {
    mid: number;
    retTopic?: string;
    payload?: string;
    msgFrom?: string;
  } = {
    mid: 0,
  };

  while (offset < data.length) {
    if (offset + 5 > data.length) break;
    const len = data.readUInt32LE(offset);
    const type = data[offset + 4];
    const fieldData = data.subarray(offset + 5, offset + 5 + len);

    switch (type) {
      case 0: // ID
        result.mid = fieldData.readUInt32LE(0);
        break;
      case 1: // RET_TOPIC
        result.retTopic = fieldData.toString('utf-8').replace(/\0+$/, '');
        break;
      case 2: // PAYLOAD
        result.payload = fieldData.toString('utf-8').replace(/\0+$/, '');
        break;
      case 3: // FROM
        result.msgFrom = fieldData.toString('utf-8').replace(/\0+$/, '');
        break;
    }

    offset += 5 + len;
  }

  return result;
}

export class XiaomiLocalMqttClient {
  private readonly did: string;
  private readonly host: string;
  private readonly port: number;
  private readonly caFile: string;
  private readonly certFile: string;
  private readonly keyFile: string;
  private readonly homeName: string;
  private readonly replyTopic: string;
  private mqtt: MqttClient | null = null;
  private connected = false;
  private seedId: number;
  private readonly pendingRequests = new Map<number, PendingRequest>();

  constructor(options: LocalMqttClientOptions) {
    this.did = options.did;
    this.host = options.host;
    this.port = options.port ?? 8883;
    this.caFile = options.caFile;
    this.certFile = options.certFile;
    this.keyFile = options.keyFile;
    this.homeName = options.homeName ?? '';
    this.replyTopic = `${options.did}/reply`;
    this.seedId = randomInt(0, 0xffffffff);
  }

  /** Connect to the gateway MQTT broker. */
  async connect(): Promise<void> {
    const ca = readFileSync(this.caFile);
    const cert = readFileSync(this.certFile);
    const key = readFileSync(this.keyFile);

    return new Promise((resolve, reject) => {
      const mqtt = connect(`mqtts://${this.host}:${this.port}`, {
        clientId: this.did,
        protocolVersion: 5,
        clean: true,
        keepalive: 60,
        reconnectPeriod: 10_000,
        connectTimeout: 10_000,
        rejectUnauthorized: false,
        ca,
        cert,
        key,
      });
      this.mqtt = mqtt;

      mqtt.on('connect', () => {
        this.connected = true;
        // Subscribe to reply topic and device list changes
        mqtt.subscribe(`${this.did}/#`, {qos: 2});
        mqtt.subscribe('master/appMsg/devListChange', {qos: 2});
        resolve();
      });

      mqtt.on('error', err => {
        if (!this.connected) {
          reject(err);
        }
      });

      mqtt.on('message', (topic, payload) => {
        this.onMessage(topic, payload);
      });

      mqtt.on('close', () => {
        this.connected = false;
      });
    });
  }

  /** Disconnect from the gateway. */
  async disconnect(): Promise<void> {
    if (!this.mqtt) return;
    // Reject all pending requests
    for (const req of this.pendingRequests.values()) {
      clearTimeout(req.timer);
      req.reject(new Error('Disconnected'));
    }
    this.pendingRequests.clear();

    await new Promise<void>(resolve => {
      this.mqtt!.end(false, () => resolve());
    });
    this.mqtt = null;
    this.connected = false;
  }

  /** Get a device property. */
  async getProp(
    did: string,
    siid: number,
    piid: number,
    timeoutMs: number = 10_000,
  ): Promise<unknown> {
    const result = await this.request(
      'proxy/get',
      JSON.stringify({did, siid, piid}),
      timeoutMs,
    );
    if (result && typeof result === 'object' && 'value' in result) {
      return (result as Record<string, unknown>).value;
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
    const payload = {
      did,
      rpc: {
        id: this.nextId(),
        method: 'set_properties',
        params: [{did, siid, piid, value}],
      },
    };
    const result = await this.request(
      'proxy/rpcReq',
      JSON.stringify(payload),
      timeoutMs,
    );
    if (result && typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      if (
        'result' in obj &&
        Array.isArray(obj.result) &&
        obj.result.length > 0
      ) {
        return obj.result[0] as Record<string, unknown>;
      }
      if ('error' in obj) {
        return obj.error as Record<string, unknown>;
      }
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
    const payload = {
      did,
      rpc: {
        id: this.nextId(),
        method: 'action',
        params: {did, siid, aiid, in: inList},
      },
    };
    const result = await this.request(
      'proxy/rpcReq',
      JSON.stringify(payload),
      timeoutMs,
    );
    if (result && typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      if ('result' in obj) {
        return obj.result as Record<string, unknown>;
      }
      if ('error' in obj) {
        return obj.error as Record<string, unknown>;
      }
    }
    return {code: -1, message: 'Invalid result'};
  }

  /** Get the device list from the gateway. */
  async getDevList(
    timeoutMs: number = 10_000,
  ): Promise<Record<string, unknown>> {
    const result = await this.request('proxy/getDevList', '{}', timeoutMs);
    if (result && typeof result === 'object' && 'devList' in result) {
      return (result as Record<string, unknown>).devList as Record<
        string,
        unknown
      >;
    }
    return {};
  }

  /** Subscribe to a device's property changes. */
  subProp(
    did: string,
    handler: (msg: Record<string, unknown>) => void,
    siid?: number,
    piid?: number,
  ): void {
    const topic = `appMsg/notify/iot/${did}/property/${siid === undefined || piid === undefined ? '#' : `${siid}.${piid}`}`;
    const subTopic = `${this.did}/${topic}`;
    this.mqtt?.subscribe(subTopic, {qos: 2});

    this.mqtt?.on('message', (msgTopic, payload) => {
      if (msgTopic === subTopic) {
        try {
          const mipsMsg = unpackMipsMessage(payload);
          if (mipsMsg.payload) {
            const msg = JSON.parse(mipsMsg.payload);
            handler(msg);
          }
        } catch {
          // ignore
        }
      }
    });
  }

  private nextId(): number {
    const id = this.seedId;
    this.seedId = (this.seedId + 1) % 0xffffffff;
    return id;
  }

  private async request(
    topic: string,
    payload: string,
    timeoutMs: number,
  ): Promise<unknown> {
    if (!this.mqtt || !this.connected) {
      throw new Error('Not connected to gateway');
    }

    const mid = this.nextId();
    const pubTopic = `master/${topic}`;
    const mipsMsg = packMipsMessage(mid, payload, 'local', this.replyTopic);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(mid);
        reject(new Error(`Request timed out (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingRequests.set(mid, {resolve, reject, timer});
      this.mqtt!.publish(pubTopic, mipsMsg, {qos: 2});
    });
  }

  private onMessage(topic: string, payload: Buffer): void {
    // Handle reply messages
    if (topic === this.replyTopic) {
      try {
        const mipsMsg = unpackMipsMessage(payload);
        const pending = this.pendingRequests.get(mipsMsg.mid);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(mipsMsg.mid);
          if (mipsMsg.payload) {
            try {
              pending.resolve(JSON.parse(mipsMsg.payload));
            } catch {
              pending.resolve(mipsMsg.payload);
            }
          } else {
            pending.resolve(null);
          }
        }
      } catch {
        // ignore malformed messages
      }
    }
  }
}
