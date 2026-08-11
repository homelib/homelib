import type {MiotProperty} from '../miot/index.js';

import type {
  CloudMqttDeviceMessage,
  CloudMqttDeviceMessageHandler,
} from './mqtt.js';

export class CloudDeviceChannel {
  private readonly observerEntrySet = new Set<CloudDeviceObserverEntry>();

  private readonly propertyCacheMap = new Map<string, CloudPropertyUpdate>();

  private readonly propertyRevisionMap = new Map<string, number>();

  private revision = 0;

  private snapshotGeneration = 0;

  private online: boolean | undefined;

  private subscribed = false;

  private subscribePromise: Promise<void> | undefined;

  private unsubscribePromise: Promise<void> | undefined;

  private disconnectedSnapshotBaselineMap:
    ReadonlyMap<string, number> | undefined;

  private readonly messageHandler: CloudMqttDeviceMessageHandler;

  constructor(
    readonly did: string,
    private readonly messageSource: CloudDeviceMessageSource,
    private readonly readProperties: CloudPropertyReader,
    private readonly onEmpty: () => void,
  ) {
    this.messageHandler = message => {
      this.handleMessage(message);
    };
  }

  async subscribe(
    properties: readonly MiotProperty[],
    observer: CloudDeviceObserver,
  ): Promise<CloudDeviceSubscription> {
    const propertyMap = createPropertyMap(this.did, properties);
    const observerEntry = {propertyMap, observer};
    const missingProperties: MiotProperty[] = [];
    const snapshotBaselineMap = new Map<string, number>();

    this.observerEntrySet.add(observerEntry);

    for (const [key, property] of propertyMap) {
      const cached = this.propertyCacheMap.get(key);

      if (cached === undefined) {
        missingProperties.push(property);
        snapshotBaselineMap.set(key, this.propertyRevisionMap.get(key) ?? 0);
      } else {
        callObserver(observer, 'onPropertyChanged', cached);
      }
    }

    if (this.online !== undefined) {
      callObserver(observer, 'onOnlineChanged', {
        did: this.did,
        online: this.online,
      });
    }

    try {
      await this.ensureSubscribed();
    } catch (error) {
      await this.removeObserver(observerEntry);
      throw error;
    }

    try {
      await this.refresh(missingProperties, snapshotBaselineMap);
    } catch (error) {
      notifyObserverError(observer, error);
    }

    let disposed = false;

    return {
      refresh: async () => {
        if (disposed) {
          throw new Error(`Cloud device subscription ${this.did} is disposed.`);
        }

        await this.refresh([...propertyMap.values()]);
      },
      dispose: async () => {
        if (disposed) {
          return;
        }

        disposed = true;
        await this.removeObserver(observerEntry);
      },
    };
  }

  handleConnectionState(connected: boolean): void {
    if (!connected) {
      this.snapshotGeneration++;
      this.disconnectedSnapshotBaselineMap = this.captureObservedRevisions();
      this.propertyCacheMap.clear();
      this.online = undefined;
      return;
    }

    const snapshotBaselineMap = this.disconnectedSnapshotBaselineMap;
    this.disconnectedSnapshotBaselineMap = undefined;

    if (snapshotBaselineMap === undefined) {
      return;
    }

    const properties = this.getObservedProperties();

    void this.refresh(
      properties,
      snapshotBaselineMap,
      this.snapshotGeneration,
    ).catch(error => {
      this.notifyError(error);
    });
  }

  private async ensureSubscribed(): Promise<void> {
    const unsubscribePromise = this.unsubscribePromise;

    if (unsubscribePromise !== undefined) {
      await unsubscribePromise;
    }

    if (this.subscribed) {
      return;
    }

    let subscribePromise = this.subscribePromise;

    if (subscribePromise === undefined) {
      subscribePromise = this.messageSource
        .subscribeDevice(this.did, this.messageHandler)
        .then(() => {
          this.subscribed = true;
        });
      this.subscribePromise = subscribePromise;
    }

    try {
      await subscribePromise;
    } finally {
      if (this.subscribePromise === subscribePromise) {
        this.subscribePromise = undefined;
      }
    }
  }

  private async refresh(
    properties: readonly MiotProperty[],
    snapshotBaselineMap: ReadonlyMap<string, number> = this.captureRevisions(
      properties,
    ),
    snapshotGeneration = this.snapshotGeneration,
  ): Promise<void> {
    if (properties.length === 0) {
      return;
    }

    const propertyMap = createPropertyMap(this.did, properties);
    const results = await this.readProperties([...propertyMap.values()]);
    const resultMap = new Map<string, CloudPropertySnapshot>();

    for (const result of results) {
      if (result.did !== this.did) {
        this.notifyError(
          new Error(`Cloud snapshot returned unexpected device ${result.did}.`),
        );
        continue;
      }

      const key = getPropertyKey(result);

      if (!propertyMap.has(key)) {
        this.notifyError(
          new Error(`Cloud snapshot returned unexpected property ${key}.`),
        );
      } else if (resultMap.has(key)) {
        this.notifyPropertyError(
          key,
          new Error(`Cloud snapshot returned duplicate property ${key}.`),
        );
      } else {
        resultMap.set(key, result);
      }
    }

    for (const [key, property] of propertyMap) {
      if (snapshotGeneration !== this.snapshotGeneration) {
        return;
      }

      const baseline = snapshotBaselineMap.get(key) ?? 0;
      const currentRevision = this.propertyRevisionMap.get(key) ?? 0;

      if (currentRevision !== baseline) {
        continue;
      }

      const result = resultMap.get(key);

      if (result === undefined) {
        this.notifyPropertyError(
          key,
          new Error(`Cloud snapshot omitted property ${key}.`),
        );
      } else if (result.code !== 0 && result.code !== 1) {
        this.notifyPropertyError(
          key,
          new Error(`Cloud snapshot property ${key} failed: ${result.code}.`),
        );
      } else if (!Object.hasOwn(result, 'value')) {
        this.notifyPropertyError(
          key,
          new Error(`Cloud snapshot property ${key} has no value.`),
        );
      } else {
        this.applyProperty(property, result.value, 'snapshot');
      }
    }
  }

  private handleMessage(message: CloudMqttDeviceMessage): void {
    if (message.did !== this.did) {
      this.notifyError(
        new Error(`Cloud MQTT routed unexpected device ${message.did}.`),
      );
      return;
    }

    if (message.type === 'property') {
      this.applyProperty(
        {did: message.did, siid: message.siid, piid: message.piid},
        message.value,
        'mqtt',
      );
    } else if (message.type === 'event') {
      const event: CloudEvent = {
        did: message.did,
        siid: message.siid,
        eiid: message.eiid,
        arguments: message.arguments,
      };

      for (const {observer} of this.observerEntrySet) {
        callObserver(observer, 'onEventOccurred', event);
      }
    } else {
      this.online = message.online;

      const state = {did: message.did, online: message.online};

      for (const {observer} of this.observerEntrySet) {
        callObserver(observer, 'onOnlineChanged', state);
      }
    }
  }

  private applyProperty(
    property: MiotProperty,
    value: unknown,
    source: CloudPropertyUpdateSource,
  ): void {
    const key = getPropertyKey(property);
    const revision = ++this.revision;
    const update: CloudPropertyUpdate = {
      ...property,
      value,
      revision,
      source,
    };

    this.propertyCacheMap.set(key, update);
    this.propertyRevisionMap.set(key, revision);

    for (const {propertyMap, observer} of this.observerEntrySet) {
      if (propertyMap.has(key)) {
        callObserver(observer, 'onPropertyChanged', update);
      }
    }
  }

  private async removeObserver(
    observerEntry: CloudDeviceObserverEntry,
  ): Promise<void> {
    if (!this.observerEntrySet.delete(observerEntry)) {
      return;
    }

    const subscribePromise = this.subscribePromise;

    if (subscribePromise !== undefined) {
      await subscribePromise.catch(() => undefined);
    }

    if (this.observerEntrySet.size > 0) {
      return;
    }

    if (!this.subscribed) {
      this.onEmpty();
      return;
    }

    this.subscribed = false;
    const unsubscribePromise = this.messageSource.unsubscribeDevice(this.did);
    this.unsubscribePromise = unsubscribePromise;

    try {
      await unsubscribePromise;
    } finally {
      if (this.unsubscribePromise === unsubscribePromise) {
        this.unsubscribePromise = undefined;
      }
    }

    if (this.observerEntrySet.size === 0) {
      this.onEmpty();
    }
  }

  private captureObservedRevisions(): ReadonlyMap<string, number> {
    return this.captureRevisions(this.getObservedProperties());
  }

  private captureRevisions(
    properties: readonly MiotProperty[],
  ): ReadonlyMap<string, number> {
    return new Map(
      properties.map(property => {
        const key = getPropertyKey(property);
        return [key, this.propertyRevisionMap.get(key) ?? 0] as const;
      }),
    );
  }

  private getObservedProperties(): MiotProperty[] {
    const propertyMap = new Map<string, MiotProperty>();

    for (const entry of this.observerEntrySet) {
      for (const [key, property] of entry.propertyMap) {
        propertyMap.set(key, property);
      }
    }

    return [...propertyMap.values()];
  }

  private notifyPropertyError(key: string, error: Error): void {
    for (const {propertyMap, observer} of this.observerEntrySet) {
      if (propertyMap.has(key)) {
        notifyObserverError(observer, error);
      }
    }
  }

  private notifyError(error: unknown): void {
    for (const {observer} of this.observerEntrySet) {
      notifyObserverError(observer, error);
    }
  }
}

export type CloudDeviceSubscription = {
  refresh(): Promise<void>;
  dispose(): Promise<void>;
};

export type CloudDeviceObserver = {
  readonly onPropertyChanged?: (update: CloudPropertyUpdate) => void;
  readonly onEventOccurred?: (event: CloudEvent) => void;
  readonly onOnlineChanged?: (state: CloudDeviceState) => void;
  readonly onError?: (error: unknown) => void;
};

export type CloudPropertyUpdate = MiotProperty & {
  readonly value: unknown;
  readonly revision: number;
  readonly source: CloudPropertyUpdateSource;
};

export type CloudPropertyUpdateSource = 'snapshot' | 'mqtt';

export type CloudEvent = {
  readonly did: string;
  readonly siid: number;
  readonly eiid: number;
  readonly arguments: readonly unknown[];
};

export type CloudDeviceState = {
  readonly did: string;
  readonly online: boolean;
};

export type CloudPropertySnapshot = MiotProperty & {
  readonly value?: unknown;
  readonly code: number;
};

export type CloudPropertyReader = (
  properties: readonly MiotProperty[],
) => Promise<readonly CloudPropertySnapshot[]>;

export type CloudDeviceMessageSource = {
  subscribeDevice(
    did: string,
    handler: CloudMqttDeviceMessageHandler,
  ): Promise<void>;
  unsubscribeDevice(did: string): Promise<void>;
};

type CloudDeviceObserverEntry = {
  readonly propertyMap: ReadonlyMap<string, MiotProperty>;
  readonly observer: CloudDeviceObserver;
};

function createPropertyMap(
  did: string,
  properties: readonly MiotProperty[],
): Map<string, MiotProperty> {
  const propertyMap = new Map<string, MiotProperty>();

  for (const property of properties) {
    if (property.did !== did) {
      throw new Error(
        `Cloud device ${did} cannot observe property for ${property.did}.`,
      );
    }

    propertyMap.set(getPropertyKey(property), property);
  }

  return propertyMap;
}

function getPropertyKey(property: {
  readonly siid: number;
  readonly piid: number;
}): string {
  return `${property.siid}.${property.piid}`;
}

function callObserver<
  TName extends 'onPropertyChanged' | 'onEventOccurred' | 'onOnlineChanged',
>(
  observer: CloudDeviceObserver,
  name: TName,
  value: Parameters<NonNullable<CloudDeviceObserver[TName]>>[0],
): void {
  const callback = observer[name] as
    | ((value: Parameters<NonNullable<CloudDeviceObserver[TName]>>[0]) => void)
    | undefined;

  if (callback === undefined) {
    return;
  }

  try {
    callback(value);
  } catch (error) {
    console.error(error);
  }
}

function notifyObserverError(
  observer: CloudDeviceObserver,
  error: unknown,
): void {
  if (observer.onError === undefined) {
    console.error(error);
    return;
  }

  try {
    observer.onError(error);
  } catch (observerError) {
    console.error(observerError);
  }
}
