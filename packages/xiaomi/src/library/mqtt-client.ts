/**
 * Xiaomi MIoT MQTT cloud client.
 *
 * Connects to the Xiaomi cloud MQTT broker to subscribe to device property
 * changes, events, and online/offline state. This is the Node.js equivalent
 * of the Python `MipsCloudClient` from ha_xiaomi_home.
 *
 * The cloud broker uses TLS on port 8883 with username = app_id (OAuth2
 * client ID) and password = access_token.
 */

import {type IClientOptions, type MqttClient, connect} from 'mqtt';

import {
  type CloudServer,
  MIHOME_MQTT_KEEPALIVE,
  getBrokerHost,
} from './constants.js';

export type DeviceStateHandler = (
  did: string,
  online: boolean,
  ctx: unknown,
) => void;

export type PropChangeHandler = (
  params: Record<string, unknown>,
  ctx: unknown,
) => void;

export type EventOccurredHandler = (
  params: Record<string, unknown>,
  ctx: unknown,
) => void;

export type MqttCloudClientOptions = {
  uuid: string;
  cloudServer: CloudServer;
  appId: string;
  token: string;
  port?: number;
};

type BroadcastEntry = {
  topic: string;
  handler: (topic: string, payload: string, ctx: unknown) => void;
  ctx: unknown;
};

export class XiaomiMqttCloudClient {
  private readonly clientId: string;
  private readonly host: string;
  private readonly port: number;
  private readonly username: string;
  private password: string;
  private mqtt: MqttClient | null = null;
  private readonly broadcasts = new Map<string, BroadcastEntry>();
  private connected = false;

  constructor(options: MqttCloudClientOptions) {
    this.clientId = `ha.${options.uuid}`;
    this.host = getBrokerHost(options.cloudServer);
    this.port = options.port ?? 8883;
    this.username = options.appId;
    this.password = options.token;
  }

  /** Update the access token (password) after a token refresh. */
  updateAccessToken(token: string): void {
    this.password = token;
    if (this.mqtt) {
      // mqtt.js doesn't support live password updates; reconnect needed.
      this.mqtt.options.password = token;
    }
  }

  /** Connect to the cloud MQTT broker. */
  async connect(): Promise<void> {
    const options: IClientOptions = {
      clientId: this.clientId,
      username: this.username,
      password: this.password,
      keepalive: MIHOME_MQTT_KEEPALIVE,
      protocolVersion: 5,
      clean: true,
      reconnectPeriod: 10_000,
      connectTimeout: 30_000,
      rejectUnauthorized: false, // Xiaomi broker uses a self-signed CA chain.
    };

    return new Promise((resolve, reject) => {
      const mqtt = connect(`mqtts://${this.host}:${this.port}`, options);
      this.mqtt = mqtt;

      mqtt.on('connect', () => {
        this.connected = true;
        // Re-subscribe to all registered topics.
        for (const entry of this.broadcasts.values()) {
          mqtt.subscribe(entry.topic, {qos: 2});
        }
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

  /** Disconnect from the broker. */
  async disconnect(): Promise<void> {
    if (!this.mqtt) return;
    await new Promise<void>(resolve => {
      this.mqtt!.end(false, () => resolve());
    });
    this.mqtt = null;
    this.connected = false;
  }

  /** Subscribe to a device's property changes. */
  subProp(
    did: string,
    handler: PropChangeHandler,
    ctx: unknown = null,
    siid?: number,
    piid?: number,
  ): void {
    const topic =
      siid === undefined || piid === undefined
        ? `device/${did}/up/properties_changed/#`
        : `device/${did}/up/properties_changed/${siid}/${piid}`;

    this.registerBroadcast(
      topic,
      (topic, payload, ctx) => {
        try {
          const msg = JSON.parse(payload);
          if (msg.params && msg.params.siid !== undefined) {
            handler(msg.params, ctx);
          }
        } catch {
          // ignore malformed messages
        }
      },
      ctx,
    );
  }

  /** Unsubscribe from a device's property changes. */
  unsubProp(did: string, siid?: number, piid?: number): void {
    const topic =
      siid === undefined || piid === undefined
        ? `device/${did}/up/properties_changed/#`
        : `device/${did}/up/properties_changed/${siid}/${piid}`;
    this.unregisterBroadcast(topic);
  }

  /** Subscribe to a device's events. */
  subEvent(
    did: string,
    handler: EventOccurredHandler,
    ctx: unknown = null,
    siid?: number,
    eiid?: number,
  ): void {
    const topic =
      siid === undefined || eiid === undefined
        ? `device/${did}/up/event_occured/#`
        : `device/${did}/up/event_occured/${siid}/${eiid}`;

    this.registerBroadcast(
      topic,
      (topic, payload, ctx) => {
        try {
          const msg = JSON.parse(payload);
          if (msg.params && msg.params.siid !== undefined) {
            msg.params.from = 'cloud';
            handler(msg.params, ctx);
          }
        } catch {
          // ignore
        }
      },
      ctx,
    );
  }

  /** Unsubscribe from a device's events. */
  unsubEvent(did: string, siid?: number, eiid?: number): void {
    const topic =
      siid === undefined || eiid === undefined
        ? `device/${did}/up/event_occured/#`
        : `device/${did}/up/event_occured/${siid}/${eiid}`;
    this.unregisterBroadcast(topic);
  }

  /** Subscribe to a device's online/offline state. */
  subDeviceState(
    did: string,
    handler: DeviceStateHandler,
    ctx: unknown = null,
  ): void {
    // BLE and proxy gateway child devices don't publish state in cloud.
    if (did.startsWith('blt.') || did.startsWith('proxy.')) {
      return;
    }
    const topic = `device/${did}/state/#`;
    this.registerBroadcast(
      topic,
      (topic, payload, ctx) => {
        try {
          const msg = JSON.parse(payload);
          if (msg.device_id !== did) return;
          handler(did, msg.event === 'online', ctx);
        } catch {
          // ignore
        }
      },
      ctx,
    );
  }

  /** Unsubscribe from a device's state. */
  unsubDeviceState(did: string): void {
    const topic = `device/${did}/state/#`;
    this.unregisterBroadcast(topic);
  }

  private registerBroadcast(
    topic: string,
    handler: (topic: string, payload: string, ctx: unknown) => void,
    ctx: unknown,
  ): void {
    if (this.broadcasts.has(topic)) return;
    this.broadcasts.set(topic, {topic, handler, ctx});
    if (this.mqtt && this.connected) {
      this.mqtt.subscribe(topic, {qos: 2});
    }
  }

  private unregisterBroadcast(topic: string): void {
    if (!this.broadcasts.has(topic)) return;
    this.broadcasts.delete(topic);
    if (this.mqtt && this.connected) {
      this.mqtt.unsubscribe(topic);
    }
  }

  private onMessage(topic: string, payload: Buffer): void {
    const payloadStr = payload.toString('utf-8');
    for (const entry of this.broadcasts.values()) {
      if (topicMatches(entry.topic, topic)) {
        entry.handler(topic, payloadStr, entry.ctx);
      }
    }
  }
}

/**
 * Check if a MQTT topic matches a subscription pattern (with `#` and `+`
 * wildcards).
 */
function topicMatches(filter: string, topic: string): boolean {
  const filterParts = filter.split('/');
  const topicParts = topic.split('/');

  for (let i = 0; i < filterParts.length; i++) {
    const part = filterParts[i];
    if (part === '#') return true;
    if (i >= topicParts.length) return false;
    if (part !== '+' && part !== topicParts[i]) return false;
  }
  return filterParts.length === topicParts.length;
}
