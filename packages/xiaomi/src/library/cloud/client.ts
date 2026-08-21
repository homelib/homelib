import type {BackendClient} from '../backend/index.js';
import type {MiotProperty} from '../miot/index.js';

import {
  CloudDeviceChannel,
  type CloudDeviceListener,
  type CloudDeviceMessageSource,
  type CloudDeviceSubscription,
  type CloudDeviceSubscriptionRequest,
  type CloudPropertyReadPriority,
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
    private readonly localStateReader?: CloudDeviceStateReader,
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

  subscribeDevice(
    did: string,
    properties: readonly MiotProperty[],
    listener: CloudDeviceListener,
  ): Promise<CloudDeviceSubscription>;
  subscribeDevice(
    did: string,
    request: CloudDeviceSubscriptionRequest,
    listener: CloudDeviceListener,
  ): Promise<CloudDeviceSubscription>;
  async subscribeDevice(
    did: string,
    requestOrProperties:
      CloudDeviceSubscriptionRequest | readonly MiotProperty[],
    listener: CloudDeviceListener,
  ): Promise<CloudDeviceSubscription> {
    const request = normalizeSubscriptionRequest(requestOrProperties);
    let channel = this.deviceChannelMap.get(did);

    if (channel === undefined) {
      const newChannel = new CloudDeviceChannel(
        did,
        this.messageClient,
        (requestedProperties, cloudPreferredProperties, priority) =>
          this.readProperties(
            requestedProperties,
            cloudPreferredProperties,
            priority,
          ),
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

    return channel.subscribe(request, listener);
  }

  private async readProperties(
    properties: readonly MiotProperty[],
    cloudPreferredProperties: readonly MiotProperty[],
    priority: CloudPropertyReadPriority,
  ): Promise<readonly CloudPropertySnapshot[]> {
    const {localStateReader} = this;

    if (localStateReader === undefined) {
      return this.backendClient.getProperties(properties);
    }

    const cloudPreferredKeySet = new Set(
      cloudPreferredProperties.map(getPropertyKey),
    );
    const localPreferredProperties = properties.filter(
      property => !cloudPreferredKeySet.has(getPropertyKey(property)),
    );
    const snapshots = await Promise.all([
      readPropertiesWithFallback(
        localPreferredProperties,
        requestedProperties => {
          return priority === 'event'
            ? localStateReader.getProperties(requestedProperties, priority)
            : localStateReader.getProperties(requestedProperties);
        },
        requestedProperties =>
          this.backendClient.getProperties(requestedProperties),
      ),
      readPropertiesWithFallback(
        cloudPreferredProperties,
        requestedProperties =>
          this.backendClient.getProperties(requestedProperties),
        requestedProperties => {
          return priority === 'event'
            ? localStateReader.getProperties(requestedProperties, priority)
            : localStateReader.getProperties(requestedProperties);
        },
      ),
    ]);

    return snapshots.flat();
  }

  private async readOnline(did: string): Promise<boolean> {
    if (this.localStateReader !== undefined) {
      try {
        return await this.localStateReader.getDeviceOnline(did);
      } catch {
        // The preferred local route is optional; cloud remains the fallback.
      }
    }

    return this.backendClient.getDeviceOnline(did);
  }
}

function normalizeSubscriptionRequest(
  requestOrProperties: CloudDeviceSubscriptionRequest | readonly MiotProperty[],
): CloudDeviceSubscriptionRequest {
  if (!Array.isArray(requestOrProperties)) {
    return requestOrProperties as CloudDeviceSubscriptionRequest;
  }

  return {
    snapshotProperties: requestOrProperties,
    notifications: requestOrProperties.map(property => ({
      type: 'property-change' as const,
      data: property,
    })),
  };
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
    priority?: CloudPropertyReadPriority,
  ): Promise<readonly CloudPropertySnapshot[]>;
  getDeviceOnline(did: string): Promise<boolean>;
};

function collectSuccessfulPropertyResults(
  properties: readonly MiotProperty[],
  snapshot: readonly CloudPropertySnapshot[],
): ReadonlyMap<string, CloudPropertySnapshot> {
  const expectedKeySet = new Set(properties.map(getPropertyKey));
  const resultMap = new Map<string, CloudPropertySnapshot>();
  const duplicateKeySet = new Set<string>();

  for (const result of snapshot) {
    const key = getPropertyKey(result);

    if (!expectedKeySet.has(key) || duplicateKeySet.has(key)) {
      continue;
    } else if (resultMap.has(key)) {
      resultMap.delete(key);
      duplicateKeySet.add(key);
      continue;
    }

    resultMap.set(key, result);
  }

  for (const [key, result] of resultMap) {
    if (
      (result.code !== 0 && result.code !== 1) ||
      !Object.hasOwn(result, 'value')
    ) {
      resultMap.delete(key);
    }
  }

  return resultMap;
}

async function readPropertiesWithFallback(
  properties: readonly MiotProperty[],
  primaryReader: CloudDeviceStateReader['getProperties'],
  fallbackReader: CloudDeviceStateReader['getProperties'],
): Promise<readonly CloudPropertySnapshot[]> {
  if (properties.length === 0) {
    return [];
  }

  let primarySnapshot: readonly CloudPropertySnapshot[];

  try {
    primarySnapshot = await primaryReader(properties);
  } catch (error) {
    try {
      return selectExpectedPropertyResults(
        properties,
        await fallbackReader(properties),
      );
    } catch {
      throw error;
    }
  }

  const primaryResultMap = collectSuccessfulPropertyResults(
    properties,
    primarySnapshot,
  );
  const missingProperties = properties.filter(
    property => !primaryResultMap.has(getPropertyKey(property)),
  );

  if (missingProperties.length === 0) {
    return primarySnapshot;
  }

  let fallbackSnapshot: readonly CloudPropertySnapshot[];

  try {
    fallbackSnapshot = await fallbackReader(missingProperties);
  } catch {
    return primarySnapshot;
  }

  const fallbackResultMap = collectSuccessfulPropertyResults(
    missingProperties,
    fallbackSnapshot,
  );

  if (fallbackResultMap.size === 0) {
    return primarySnapshot;
  }

  return [
    ...primarySnapshot.filter(
      result => !fallbackResultMap.has(getPropertyKey(result)),
    ),
    ...fallbackResultMap.values(),
  ];
}

function selectExpectedPropertyResults(
  properties: readonly MiotProperty[],
  snapshot: readonly CloudPropertySnapshot[],
): readonly CloudPropertySnapshot[] {
  const expectedKeySet = new Set(properties.map(getPropertyKey));

  return snapshot.filter(result => expectedKeySet.has(getPropertyKey(result)));
}

function getPropertyKey(property: MiotProperty): string {
  return `${property.did}.${property.siid}.${property.piid}`;
}
