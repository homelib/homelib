import type {BackendClient} from '../backend/index.js';
import type {MiotProperty} from '../miot/index.js';

import {
  CloudDeviceChannel,
  type CloudDeviceListener,
  type CloudDeviceMessageSource,
  type CloudDeviceSubscription,
  type CloudPropertySnapshot,
} from './device.js';
import {
  CloudMqttClient,
  type CloudMqttConnectionStateListener,
} from './mqtt.js';

export class CloudClient {
  private readonly backendClient: BackendClient;

  private readonly messageClient: CloudDeviceMessageClient;

  private readonly deviceChannelMap = new Map<string, CloudDeviceChannel>();

  constructor(
    backendClient: BackendClient,
    messageClient: CloudDeviceMessageClient = new CloudMqttClient({
      uuid: backendClient.uuid,
      accessToken: backendClient.accessToken,
      cloudServer: backendClient.cloudServer,
    }),
    private readonly preferredStateReader?: CloudDeviceStateReader,
  ) {
    this.backendClient = backendClient;
    this.messageClient = messageClient;
    this.messageClient.addConnectionStateListener(connected => {
      for (const channel of this.deviceChannelMap.values()) {
        channel.handleConnectionState(connected);
      }
    });
  }

  updateAccessToken(accessToken: string): void {
    this.backendClient.updateAccessToken(accessToken);
    this.messageClient.updateAccessToken(accessToken);
  }

  async connect(): Promise<void> {
    await this.messageClient.connect();
  }

  async disconnect(): Promise<void> {
    await this.messageClient.disconnect();
  }

  async subscribeDevice(
    did: string,
    properties: readonly MiotProperty[],
    listener: CloudDeviceListener,
  ): Promise<CloudDeviceSubscription> {
    let channel = this.deviceChannelMap.get(did);

    if (channel === undefined) {
      const newChannel = new CloudDeviceChannel(
        did,
        this.messageClient,
        requestedProperties => this.readProperties(requestedProperties),
        () => this.readOnline(did),
        () => {
          if (this.deviceChannelMap.get(did) === newChannel) {
            this.deviceChannelMap.delete(did);
          }
        },
      );
      channel = newChannel;
      this.deviceChannelMap.set(did, channel);
    }

    return channel.subscribe(properties, listener);
  }

  private async readProperties(
    properties: readonly MiotProperty[],
  ): Promise<readonly CloudPropertySnapshot[]> {
    if (this.preferredStateReader !== undefined) {
      try {
        const snapshot =
          await this.preferredStateReader.getProperties(properties);
        assertCompletePropertySnapshot(properties, snapshot);
        return snapshot;
      } catch {
        // The preferred local route is optional; cloud remains the fallback.
      }
    }

    return this.backendClient.getProperties(properties);
  }

  private async readOnline(did: string): Promise<boolean> {
    if (this.preferredStateReader !== undefined) {
      try {
        return await this.preferredStateReader.getDeviceOnline(did);
      } catch {
        // The preferred local route is optional; cloud remains the fallback.
      }
    }

    return this.backendClient.getDeviceOnline(did);
  }
}

export type CloudDeviceMessageClient = CloudDeviceMessageSource & {
  updateAccessToken(accessToken: string): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  addConnectionStateListener(
    listener: CloudMqttConnectionStateListener,
  ): () => void;
};

export type CloudDeviceStateReader = {
  getProperties(
    properties: readonly MiotProperty[],
  ): Promise<readonly CloudPropertySnapshot[]>;
  getDeviceOnline(did: string): Promise<boolean>;
};

function assertCompletePropertySnapshot(
  properties: readonly MiotProperty[],
  snapshot: readonly CloudPropertySnapshot[],
): void {
  const expectedKeySet = new Set(properties.map(getPropertyKey));
  const actualKeySet = new Set<string>();

  for (const result of snapshot) {
    const key = getPropertyKey(result);

    if (
      !expectedKeySet.has(key) ||
      actualKeySet.has(key) ||
      (result.code !== 0 && result.code !== 1) ||
      !Object.hasOwn(result, 'value')
    ) {
      throw new Error('Preferred MIoT property snapshot is incomplete.');
    }

    actualKeySet.add(key);
  }

  if (actualKeySet.size !== expectedKeySet.size) {
    throw new Error('Preferred MIoT property snapshot is incomplete.');
  }
}

function getPropertyKey(property: MiotProperty): string {
  return `${property.did}.${property.siid}.${property.piid}`;
}
