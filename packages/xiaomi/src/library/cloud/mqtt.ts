import {type IClientOptions, type MqttClient, connectAsync} from 'mqtt';

import {type CloudServer, OAUTH2_CLIENT_ID} from '../backend/index.js';

import {
  CLOUD_MQTT_CONNECT_TIMEOUT,
  CLOUD_MQTT_KEEPALIVE,
  CLOUD_MQTT_PORT,
  CLOUD_MQTT_RECONNECT_INTERVAL,
  CLOUD_MQTT_SUBSCRIPTION_BATCH_INTERVAL,
  CLOUD_MQTT_SUBSCRIPTION_BATCH_SIZE,
  getCloudMqttHost,
} from './constants.js';

export class CloudMqttClient {
  private accessToken: string;

  private mqttClient: MqttClient | undefined;

  private connectPromise: Promise<void> | undefined;

  private readyPromise: Promise<void> | undefined;

  private readyRetryToken: object | undefined;

  private readyRetryDelayCancel: (() => void) | undefined;

  private ready = false;

  private readonly deviceHandlerMap = new Map<
    string,
    CloudMqttDeviceMessageHandler
  >();

  private readonly subscribedDeviceSet = new Set<string>();

  private readonly connectionStateHandlerSet =
    new Set<CloudMqttConnectionStateHandler>();

  constructor(
    private readonly options: CloudMqttClientOptions,
    private readonly connector: CloudMqttConnector = defaultConnector,
  ) {
    this.accessToken = options.accessToken;
  }

  updateAccessToken(accessToken: string): void {
    this.accessToken = accessToken;

    if (this.mqttClient !== undefined) {
      this.mqttClient.options.password = accessToken;
    }
  }

  async connect(): Promise<void> {
    if (this.ready) {
      return;
    }

    if (this.mqttClient !== undefined) {
      await this.waitUntilConnected(this.mqttClient);
      await this.markReady();
      return;
    }

    let connectPromise = this.connectPromise;

    if (connectPromise === undefined) {
      connectPromise = this.createConnection();
      this.connectPromise = connectPromise;
    }

    try {
      await connectPromise;
    } finally {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = undefined;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.stopReadyRetry();

    const connectPromise = this.connectPromise;

    if (connectPromise !== undefined) {
      await connectPromise.catch(() => undefined);
    }

    const mqttClient = this.mqttClient;
    this.mqttClient = undefined;
    this.subscribedDeviceSet.clear();
    this.setReady(false);

    if (mqttClient !== undefined) {
      await mqttClient.endAsync();
    }
  }

  async subscribeDevice(
    did: string,
    handler: CloudMqttDeviceMessageHandler,
  ): Promise<void> {
    validateDid(did);

    const existingHandler = this.deviceHandlerMap.get(did);

    if (existingHandler !== undefined && existingHandler !== handler) {
      throw new Error(`Cloud MQTT device ${did} is already subscribed.`);
    }

    this.deviceHandlerMap.set(did, handler);

    try {
      await this.connect();

      if (!this.subscribedDeviceSet.has(did)) {
        await this.subscribeTopics(getDeviceTopics(did));
        this.subscribedDeviceSet.add(did);
      }
    } catch (error) {
      if (existingHandler === undefined) {
        this.deviceHandlerMap.delete(did);
      }

      throw error;
    }
  }

  async unsubscribeDevice(did: string): Promise<void> {
    this.deviceHandlerMap.delete(did);

    const readyPromise = this.readyPromise;

    if (readyPromise !== undefined) {
      await readyPromise.catch(() => undefined);
    }

    this.subscribedDeviceSet.delete(did);

    const mqttClient = this.mqttClient;

    if (mqttClient !== undefined && mqttClient.connected) {
      await mqttClient.unsubscribeAsync(getDeviceTopics(did));
    }
  }

  observeConnectionState(handler: CloudMqttConnectionStateHandler): () => void {
    this.connectionStateHandlerSet.add(handler);

    return () => {
      this.connectionStateHandlerSet.delete(handler);
    };
  }

  private async createConnection(): Promise<void> {
    const mqttClient = await this.connector(
      `mqtts://${getCloudMqttHost(this.options.cloudServer)}:${CLOUD_MQTT_PORT}`,
      {
        clientId: `ha.${this.options.uuid}`,
        username: OAUTH2_CLIENT_ID,
        password: this.accessToken,
        keepalive: CLOUD_MQTT_KEEPALIVE,
        protocolVersion: 5,
        clean: true,
        reconnectPeriod: CLOUD_MQTT_RECONNECT_INTERVAL,
        connectTimeout: CLOUD_MQTT_CONNECT_TIMEOUT,
        resubscribe: false,
      },
    );
    this.mqttClient = mqttClient;

    mqttClient.on('connect', () => {
      this.startReadyRetry(mqttClient);
    });
    mqttClient.on('message', (topic, payload) => {
      this.handleMessage(topic, payload);
    });
    mqttClient.on('close', () => {
      this.stopReadyRetry();
      this.subscribedDeviceSet.clear();
      this.setReady(false);
    });
    mqttClient.on('error', console.error);

    await this.markReady();
  }

  private startReadyRetry(mqttClient: MqttClient): void {
    if (this.ready || this.readyRetryToken !== undefined) {
      return;
    }

    const token = {};
    this.readyRetryToken = token;
    void this.retryReady(mqttClient, token).finally(() => {
      if (this.readyRetryToken === token) {
        this.readyRetryToken = undefined;
      }
    });
  }

  private async retryReady(
    mqttClient: MqttClient,
    token: object,
  ): Promise<void> {
    while (
      this.readyRetryToken === token &&
      this.mqttClient === mqttClient &&
      mqttClient.connected &&
      !this.ready
    ) {
      try {
        await this.markReady();
      } catch (error) {
        console.error(error);

        if (
          this.readyRetryToken !== token ||
          this.mqttClient !== mqttClient ||
          !mqttClient.connected ||
          this.ready
        ) {
          return;
        }

        await this.waitBeforeReadyRetry(token);
      }
    }
  }

  private waitBeforeReadyRetry(token: object): Promise<void> {
    return new Promise(resolve => {
      const complete = (): void => {
        clearTimeout(timeout);

        if (this.readyRetryDelayCancel === complete) {
          this.readyRetryDelayCancel = undefined;
        }

        resolve();
      };
      const timeout = setTimeout(complete, CLOUD_MQTT_RECONNECT_INTERVAL);

      this.readyRetryDelayCancel = complete;

      if (this.readyRetryToken !== token) {
        complete();
      }
    });
  }

  private stopReadyRetry(): void {
    this.readyRetryToken = undefined;
    this.readyRetryDelayCancel?.();
  }

  private async markReady(): Promise<void> {
    if (this.ready) {
      return;
    }

    let readyPromise = this.readyPromise;

    if (readyPromise === undefined) {
      readyPromise = this.subscribeAllDevices();
      this.readyPromise = readyPromise;
    }

    try {
      await readyPromise;

      const mqttClient = this.mqttClient;

      if (mqttClient === undefined || !mqttClient.connected) {
        throw new Error('Cloud MQTT disconnected while subscribing.');
      }

      this.setReady(true);
    } finally {
      if (this.readyPromise === readyPromise) {
        this.readyPromise = undefined;
      }
    }
  }

  private async subscribeAllDevices(): Promise<void> {
    const deviceIds = [...this.deviceHandlerMap.keys()];
    const topicBatches = chunk(
      deviceIds.flatMap(getDeviceTopics),
      CLOUD_MQTT_SUBSCRIPTION_BATCH_SIZE,
    );

    for (const [index, topics] of topicBatches.entries()) {
      await this.subscribeTopics(topics);

      if (index < topicBatches.length - 1) {
        await delay(CLOUD_MQTT_SUBSCRIPTION_BATCH_INTERVAL);
      }
    }

    for (const did of deviceIds) {
      if (this.deviceHandlerMap.has(did)) {
        this.subscribedDeviceSet.add(did);
      }
    }
  }

  private async subscribeTopics(topics: readonly string[]): Promise<void> {
    if (topics.length === 0) {
      return;
    }

    const mqttClient = this.mqttClient;

    if (mqttClient === undefined || !mqttClient.connected) {
      throw new Error('Cloud MQTT is not connected.');
    }

    const grants = await mqttClient.subscribeAsync([...topics], {qos: 2});
    const grantedTopicSet = new Set(
      grants.filter(grant => grant.qos !== 128).map(grant => grant.topic),
    );

    for (const topic of topics) {
      if (!grantedTopicSet.has(topic)) {
        throw new Error(`Cloud MQTT subscription was rejected: ${topic}.`);
      }
    }
  }

  private async waitUntilConnected(mqttClient: MqttClient): Promise<void> {
    if (mqttClient.connected) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Cloud MQTT connection timed out.'));
      }, CLOUD_MQTT_CONNECT_TIMEOUT);

      const onConnect = (): void => {
        cleanup();
        resolve();
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        mqttClient.off('connect', onConnect);
      };

      mqttClient.on('connect', onConnect);
    });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    try {
      const message = parseCloudMqttMessage(topic, payload);

      if (message === undefined) {
        return;
      }

      this.deviceHandlerMap.get(message.did)?.(message);
    } catch (error) {
      console.error(error);
    }
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }

    this.ready = ready;

    if (ready) {
      this.stopReadyRetry();
    }

    for (const handler of this.connectionStateHandlerSet) {
      try {
        handler(ready);
      } catch (error) {
        console.error(error);
      }
    }
  }
}

export type CloudMqttClientOptions = {
  readonly uuid: string;
  readonly accessToken: string;
  readonly cloudServer: CloudServer;
};

export type CloudMqttPropertyMessage = {
  readonly type: 'property';
  readonly did: string;
  readonly siid: number;
  readonly piid: number;
  readonly value: unknown;
};

export type CloudMqttEventMessage = {
  readonly type: 'event';
  readonly did: string;
  readonly siid: number;
  readonly eiid: number;
  readonly arguments: readonly unknown[];
};

export type CloudMqttStateMessage = {
  readonly type: 'state';
  readonly did: string;
  readonly online: boolean;
};

export type CloudMqttDeviceMessage =
  CloudMqttPropertyMessage | CloudMqttEventMessage | CloudMqttStateMessage;

export type CloudMqttDeviceMessageHandler = (
  message: CloudMqttDeviceMessage,
) => void;

export type CloudMqttConnectionStateHandler = (connected: boolean) => void;

export type CloudMqttConnector = (
  url: string,
  options: IClientOptions,
) => Promise<MqttClient>;

function defaultConnector(
  url: string,
  options: IClientOptions,
): Promise<MqttClient> {
  return connectAsync(url, options, false);
}

function parseCloudMqttMessage(
  topic: string,
  payload: Buffer,
): CloudMqttDeviceMessage | undefined {
  const parts = topic.split('/');

  if (parts[0] !== 'device') {
    return undefined;
  }

  const did = parts[1];

  if (did === undefined) {
    return undefined;
  }

  const message = requireRecord(JSON.parse(payload.toString('utf8')));

  if (parts[2] === 'up' && parts[3] === 'properties_changed') {
    const params = requireRecord(message.params);
    const siid = requireInteger(params.siid);
    const piid = requireInteger(params.piid);

    if (!Object.hasOwn(params, 'value')) {
      throw new Error('Cloud MQTT property message has no value.');
    }

    return {type: 'property', did, siid, piid, value: params.value};
  } else if (parts[2] === 'up' && parts[3] === 'event_occured') {
    const params = requireRecord(message.params);
    const siid = requireInteger(params.siid);
    const eiid = requireInteger(params.eiid);

    if (!Array.isArray(params.arguments)) {
      throw new Error('Cloud MQTT event message has invalid arguments.');
    }

    return {type: 'event', did, siid, eiid, arguments: params.arguments};
  } else if (parts[2] === 'state') {
    const deviceId = requireString(message.device_id);
    const event = requireString(message.event);

    if (deviceId !== did) {
      throw new Error(`Cloud MQTT state message DID mismatch: ${deviceId}.`);
    }

    if (event !== 'online' && event !== 'offline') {
      throw new Error(`Cloud MQTT state message has invalid event: ${event}.`);
    }

    return {type: 'state', did, online: event === 'online'};
  }

  return undefined;
}

function getDeviceTopics(did: string): string[] {
  const topics = [
    `device/${did}/up/properties_changed/#`,
    `device/${did}/up/event_occured/#`,
  ];

  // Xiaomi cloud does not publish state for these virtual child devices.
  if (!did.startsWith('blt.') && !did.startsWith('proxy.')) {
    topics.push(`device/${did}/state/#`);
  }

  return topics;
}

function validateDid(did: string): void {
  if (did === '' || did.includes('/')) {
    throw new Error(`Invalid cloud device ID: ${did}.`);
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Cloud MQTT message is not an object.');
  }

  return value as Record<string, unknown>;
}

function requireInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('Cloud MQTT message has an invalid integer.');
  }

  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Cloud MQTT message has an invalid string.');
  }

  return value;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
