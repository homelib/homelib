import type {MiotProperty} from '../miot/index.js';

import {CLOUD_MQTT_RECONNECT_INTERVAL} from './constants.js';
import type {
  CloudMqttDeviceMessage,
  CloudMqttDeviceMessageHandler,
} from './mqtt.js';

export class CloudDeviceChannel {
  private readonly observerEntrySet = new Set<CloudDeviceObserverEntry>();

  private readonly propertyCacheMap = new Map<string, CloudPropertyUpdate>();

  private readonly propertyRevisionMap = new Map<string, number>();

  private readonly propertyRefreshSequenceMap = new Map<string, number>();

  private revision = 0;

  private refreshSequence = 0;

  private stateGeneration = 0;

  private online: boolean | undefined;

  private onlineRefreshSequence = 0;

  private subscribed = false;

  private subscribePromise: Promise<void> | undefined;

  private unsubscribePromise: Promise<void> | undefined;

  private refreshAfterReconnect = false;

  private brokerConnected = true;

  private reconnectRefreshPromise: Promise<void> | undefined;

  private reconnectRetryTimeout: ReturnType<typeof setTimeout> | undefined;

  private readonly messageHandler: CloudMqttDeviceMessageHandler;

  constructor(
    readonly did: string,
    private readonly messageSource: CloudDeviceMessageSource,
    private readonly readProperties: CloudPropertyReader,
    private readonly readOnline: CloudOnlineReader,
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
    const observerEntry: CloudDeviceObserverEntry = {
      propertyMap: createPropertyMap(this.did, properties),
      observer,
      initialized: false,
    };

    this.observerEntrySet.add(observerEntry);

    try {
      await this.ensureSubscribed();

      if (!observerEntry.initialized) {
        if (observerEntry.refreshOperation === undefined) {
          void this.refreshEntries([observerEntry]).catch(() => undefined);
        }

        await this.waitForEntryRefresh(observerEntry);
      }

      if (!observerEntry.initialized) {
        throw new Error(`Cloud device ${this.did} state was not initialized.`);
      }
    } catch (error) {
      await this.removeObserver(observerEntry);
      throw error;
    }

    let disposed = false;

    return {
      refresh: async () => {
        if (disposed) {
          throw new Error(`Cloud device subscription ${this.did} is disposed.`);
        }

        void this.refreshEntries([observerEntry]).catch(() => undefined);
        await this.waitForEntryRefresh(observerEntry);
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
      this.stateGeneration++;
      this.brokerConnected = false;
      this.refreshAfterReconnect = true;
      this.stopReconnectRefresh();
      return;
    }

    this.brokerConnected = true;
    this.startReconnectRefresh();
  }

  private startReconnectRefresh(): void {
    if (
      !this.refreshAfterReconnect ||
      !this.brokerConnected ||
      this.observerEntrySet.size === 0 ||
      this.reconnectRefreshPromise !== undefined ||
      this.reconnectRetryTimeout !== undefined
    ) {
      return;
    }

    const entries = [...this.observerEntrySet];

    void this.refreshEntries(entries).catch(() => undefined);

    const promise = Promise.all(
      entries.map(entry => this.waitForEntryRefresh(entry)),
    ).then(() => undefined);
    this.reconnectRefreshPromise = promise;

    void promise.then(
      () => {
        if (this.reconnectRefreshPromise !== promise) {
          return;
        }

        this.reconnectRefreshPromise = undefined;

        if (!this.brokerConnected || this.observerEntrySet.size === 0) {
          return;
        }

        this.refreshAfterReconnect = false;
      },
      error => {
        if (this.reconnectRefreshPromise !== promise) {
          return;
        }

        this.reconnectRefreshPromise = undefined;

        if (!this.brokerConnected || this.observerEntrySet.size === 0) {
          return;
        }

        this.notifyError(error);
        this.scheduleReconnectRefresh();
      },
    );
  }

  private scheduleReconnectRefresh(): void {
    if (
      this.reconnectRetryTimeout !== undefined ||
      !this.refreshAfterReconnect ||
      !this.brokerConnected ||
      this.observerEntrySet.size === 0
    ) {
      return;
    }

    this.reconnectRetryTimeout = setTimeout(() => {
      this.reconnectRetryTimeout = undefined;
      this.startReconnectRefresh();
    }, CLOUD_MQTT_RECONNECT_INTERVAL);
  }

  private stopReconnectRefresh(): void {
    this.reconnectRefreshPromise = undefined;

    if (this.reconnectRetryTimeout !== undefined) {
      clearTimeout(this.reconnectRetryTimeout);
      this.reconnectRetryTimeout = undefined;
    }
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

  private refreshEntries(
    requestedEntries: readonly CloudDeviceObserverEntry[],
    onlineOverride?: boolean,
  ): Promise<void> {
    const entries = requestedEntries.filter(entry =>
      this.observerEntrySet.has(entry),
    );

    if (entries.length === 0) {
      return Promise.resolve();
    }

    const token = {};
    const sequence = ++this.refreshSequence;
    let resolvePromise!: () => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    for (const entry of entries) {
      entry.refreshOperation?.replace();
      entry.refreshOperation = createRefreshOperation(token, promise);
    }

    void this.readAndPublishState(
      entries,
      token,
      sequence,
      onlineOverride,
    ).then(resolvePromise, rejectPromise);

    return promise;
  }

  private async waitForEntryRefresh(
    entry: CloudDeviceObserverEntry,
  ): Promise<void> {
    while (true) {
      const operation = entry.refreshOperation;

      if (operation === undefined) {
        return;
      }

      const outcome = await Promise.race([
        operation.promise.then(
          () => ({type: 'completed'}) as const,
          error => ({type: 'failed', error}) as const,
        ),
        operation.replaced.then(() => ({type: 'replaced'}) as const),
      ]);

      if (!this.observerEntrySet.has(entry)) {
        return;
      } else if (
        outcome.type === 'replaced' ||
        entry.refreshOperation?.token !== operation.token
      ) {
        continue;
      } else if (outcome.type === 'failed') {
        throw outcome.error;
      }

      return;
    }
  }

  private async readAndPublishState(
    entries: readonly CloudDeviceObserverEntry[],
    refreshToken: object,
    refreshSequence: number,
    onlineOverride: boolean | undefined,
  ): Promise<void> {
    const propertyMap = createEntryPropertyMap(entries);
    const propertyBaselineMap = this.captureRevisions(propertyMap);
    const generation = this.stateGeneration;
    const propertyRead = settlePromise(
      onlineOverride === false || propertyMap.size === 0
        ? Promise.resolve([])
        : Promise.resolve().then(() =>
            this.readProperties([...propertyMap.values()]),
          ),
    );
    let requestedOnline: boolean;

    try {
      requestedOnline =
        onlineOverride ??
        (await Promise.resolve().then(() => this.readOnline()));
    } catch (error) {
      if (!this.isRefreshCurrent(entries, refreshToken, generation)) {
        return;
      }

      throw error;
    }

    let currentEntries = this.getCurrentRefreshEntries(
      entries,
      refreshToken,
      generation,
    );

    if (currentEntries.length === 0) {
      return;
    } else if (typeof requestedOnline !== 'boolean') {
      throw new TypeError(
        `Cloud device ${this.did} returned invalid online state.`,
      );
    }

    let online = this.resolveRefreshOnline(requestedOnline, refreshSequence);

    if (!online) {
      this.commitRefreshOnline(false, refreshSequence);
      this.publishState(currentEntries, false, new Map());
      return;
    }

    const propertyOutcome = await propertyRead;

    currentEntries = this.getCurrentRefreshEntries(
      entries,
      refreshToken,
      generation,
    );

    if (currentEntries.length === 0) {
      return;
    }

    online = this.resolveRefreshOnline(requestedOnline, refreshSequence);

    if (!online) {
      this.publishState(currentEntries, false, new Map());
      return;
    } else if (propertyOutcome.status === 'rejected') {
      throw propertyOutcome.reason;
    }

    const currentPropertyMap = createEntryPropertyMap(currentEntries);
    const {resultMap, resultErrorMap, errors} = collectSnapshotResults(
      this.did,
      currentPropertyMap,
      propertyOutcome.value,
    );

    for (const error of errors) {
      this.notifyError(error);
    }

    const propertyErrorMap = new Map<string, unknown>();
    const propertyUpdateMap = new Map<
      string,
      {readonly property: MiotProperty; readonly value: unknown}
    >();

    for (const [key, property] of currentPropertyMap) {
      const baseline = propertyBaselineMap.get(key) ?? 0;
      const currentRevision = this.propertyRevisionMap.get(key) ?? 0;
      const cachedProperty = this.propertyCacheMap.get(key);
      const cachedRefreshSequence =
        this.propertyRefreshSequenceMap.get(key) ?? 0;

      if (
        currentRevision !== baseline &&
        cachedProperty !== undefined &&
        (cachedProperty.source === 'mqtt' ||
          cachedRefreshSequence > refreshSequence)
      ) {
        continue;
      }

      const resultError = resultErrorMap.get(key);

      if (resultError !== undefined) {
        propertyErrorMap.set(key, resultError);
        continue;
      }

      const result = resultMap.get(key);

      if (result === undefined) {
        propertyErrorMap.set(
          key,
          new Error(`Cloud snapshot omitted property ${key}.`),
        );
      } else if (result.code !== 0 && result.code !== 1) {
        propertyErrorMap.set(
          key,
          new Error(`Cloud snapshot property ${key} failed: ${result.code}.`),
        );
      } else if (!Object.hasOwn(result, 'value')) {
        propertyErrorMap.set(
          key,
          new Error(`Cloud snapshot property ${key} has no value.`),
        );
      } else {
        propertyUpdateMap.set(key, {property, value: result.value});
      }
    }

    const successfulEntries: CloudDeviceObserverEntry[] = [];
    const refreshErrors: unknown[] = [];

    for (const entry of currentEntries) {
      const entryErrors = [...entry.propertyMap.keys()].flatMap(key => {
        const error = propertyErrorMap.get(key);

        if (error === undefined) {
          return [];
        }

        const baseline = propertyBaselineMap.get(key) ?? 0;
        const currentRevision = this.propertyRevisionMap.get(key) ?? 0;

        const cachedProperty = this.propertyCacheMap.get(key);
        const cachedRefreshSequence =
          this.propertyRefreshSequenceMap.get(key) ?? 0;

        return currentRevision !== baseline &&
          cachedProperty !== undefined &&
          (cachedProperty.source === 'mqtt' ||
            cachedRefreshSequence > refreshSequence)
          ? []
          : [error];
      });

      if (entryErrors.length > 0) {
        refreshErrors.push(...entryErrors);
        continue;
      }

      successfulEntries.push(entry);
    }

    const successfulPropertyKeySet = new Set(
      successfulEntries.flatMap(entry => [...entry.propertyMap.keys()]),
    );

    for (const [key, update] of propertyUpdateMap) {
      if (successfulPropertyKeySet.has(key)) {
        this.cacheProperty(
          update.property,
          update.value,
          'snapshot',
          refreshSequence,
        );
      }
    }

    if (successfulEntries.length > 0) {
      this.commitRefreshOnline(true, refreshSequence);

      for (const entry of successfulEntries) {
        const properties = [...entry.propertyMap.keys()].map(key => {
          const property = this.propertyCacheMap.get(key);

          if (property === undefined) {
            throw new TypeError(
              `Cloud device state is missing property ${key}.`,
            );
          }

          return property;
        });

        try {
          publishObserverState(entry, {
            did: this.did,
            online: true,
            properties,
          });
        } catch (error) {
          refreshErrors.push(error);
        }
      }
    }

    if (refreshErrors.length > 0) {
      throw refreshErrors[0];
    }
  }

  private getCurrentRefreshEntries(
    entries: readonly CloudDeviceObserverEntry[],
    refreshToken: object,
    generation: number,
  ): CloudDeviceObserverEntry[] {
    if (generation !== this.stateGeneration) {
      return [];
    }

    return entries.filter(
      entry =>
        this.observerEntrySet.has(entry) &&
        entry.refreshOperation?.token === refreshToken,
    );
  }

  private isRefreshCurrent(
    entries: readonly CloudDeviceObserverEntry[],
    refreshToken: object,
    generation: number,
  ): boolean {
    return (
      this.getCurrentRefreshEntries(entries, refreshToken, generation).length >
      0
    );
  }

  private resolveRefreshOnline(
    requestedOnline: boolean,
    refreshSequence: number,
  ): boolean {
    return refreshSequence < this.onlineRefreshSequence
      ? (this.online ?? requestedOnline)
      : requestedOnline;
  }

  private commitRefreshOnline(online: boolean, refreshSequence: number): void {
    if (refreshSequence < this.onlineRefreshSequence) {
      return;
    }

    this.online = online;
    this.onlineRefreshSequence = refreshSequence;
  }

  private publishState(
    entries: readonly CloudDeviceObserverEntry[],
    online: false,
    propertyMap: ReadonlyMap<string, CloudPropertyUpdate>,
  ): void {
    const errors: unknown[] = [];

    for (const entry of entries) {
      const properties = [...entry.propertyMap.keys()].flatMap(key => {
        const property = propertyMap.get(key);
        return property === undefined ? [] : [property];
      });

      try {
        publishObserverState(entry, {did: this.did, online, properties});
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw errors[0];
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
      const update = this.cacheProperty(
        {did: message.did, siid: message.siid, piid: message.piid},
        message.value,
        'mqtt',
      );
      const key = getPropertyKey(update);

      for (const entry of this.observerEntrySet) {
        if (entry.initialized && entry.propertyMap.has(key)) {
          callObserver(entry.observer, 'onPropertyChanged', update);
        }
      }
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
    } else if (!message.online) {
      this.stateGeneration++;
      void this.refreshEntries([...this.observerEntrySet], false).catch(
        error => {
          this.notifyError(error);
        },
      );
    } else {
      this.stateGeneration++;
      void this.refreshEntries([...this.observerEntrySet], true).catch(
        error => {
          this.notifyError(error);
        },
      );
    }
  }

  private cacheProperty(
    property: MiotProperty,
    value: unknown,
    source: CloudPropertyUpdateSource,
    refreshSequence?: number,
  ): CloudPropertyUpdate {
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

    if (refreshSequence !== undefined) {
      this.propertyRefreshSequenceMap.set(key, refreshSequence);
    }

    return update;
  }

  private async removeObserver(
    observerEntry: CloudDeviceObserverEntry,
  ): Promise<void> {
    if (!this.observerEntrySet.delete(observerEntry)) {
      return;
    }

    observerEntry.refreshOperation?.replace();
    observerEntry.refreshOperation = undefined;

    const subscribePromise = this.subscribePromise;

    if (subscribePromise !== undefined) {
      await subscribePromise.catch(() => undefined);
    }

    if (this.observerEntrySet.size > 0) {
      return;
    }

    this.refreshAfterReconnect = false;
    this.stopReconnectRefresh();

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

  private captureRevisions(
    propertyMap: ReadonlyMap<string, MiotProperty>,
  ): ReadonlyMap<string, number> {
    return new Map(
      [...propertyMap.keys()].map(key => [
        key,
        this.propertyRevisionMap.get(key) ?? 0,
      ]),
    );
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
  readonly onStateChanged?: (state: CloudDeviceState) => void;
  readonly onPropertyChanged?: (update: CloudPropertyUpdate) => void;
  readonly onEventOccurred?: (event: CloudEvent) => void;
  readonly onError?: (error: unknown) => void;
};

export type CloudDeviceState = {
  readonly did: string;
  readonly online: boolean;
  readonly properties: readonly CloudPropertyUpdate[];
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

export type CloudPropertySnapshot = MiotProperty & {
  readonly value?: unknown;
  readonly code: number;
};

export type CloudPropertyReader = (
  properties: readonly MiotProperty[],
) => Promise<readonly CloudPropertySnapshot[]>;

export type CloudOnlineReader = () => Promise<boolean>;

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
  initialized: boolean;
  refreshOperation?: CloudDeviceRefreshOperation;
};

type CloudDeviceRefreshOperation = {
  readonly token: object;
  readonly promise: Promise<void>;
  readonly replaced: Promise<void>;
  replace(): void;
};

function createRefreshOperation(
  token: object,
  promise: Promise<void>,
): CloudDeviceRefreshOperation {
  let replace: () => void = () => undefined;
  const replaced = new Promise<void>(resolve => {
    replace = resolve;
  });

  return {token, promise, replaced, replace};
}

function settlePromise<T>(promise: Promise<T>): Promise<PromiseOutcome<T>> {
  return promise.then(
    value => ({status: 'fulfilled', value}),
    reason => ({status: 'rejected', reason}),
  );
}

function createEntryPropertyMap(
  entries: readonly CloudDeviceObserverEntry[],
): Map<string, MiotProperty> {
  const propertyMap = new Map<string, MiotProperty>();

  for (const entry of entries) {
    for (const [key, property] of entry.propertyMap) {
      propertyMap.set(key, property);
    }
  }

  return propertyMap;
}

function collectSnapshotResults(
  did: string,
  propertyMap: ReadonlyMap<string, MiotProperty>,
  results: readonly CloudPropertySnapshot[],
): {
  readonly resultMap: ReadonlyMap<string, CloudPropertySnapshot>;
  readonly resultErrorMap: ReadonlyMap<string, Error>;
  readonly errors: readonly Error[];
} {
  const resultMap = new Map<string, CloudPropertySnapshot>();
  const resultErrorMap = new Map<string, Error>();
  const errors: Error[] = [];

  for (const result of results) {
    if (result.did !== did) {
      errors.push(
        new Error(`Cloud snapshot returned unexpected device ${result.did}.`),
      );
      continue;
    }

    const key = getPropertyKey(result);

    if (!propertyMap.has(key)) {
      errors.push(
        new Error(`Cloud snapshot returned unexpected property ${key}.`),
      );
    } else if (resultMap.has(key) || resultErrorMap.has(key)) {
      resultMap.delete(key);
      resultErrorMap.set(
        key,
        new Error(`Cloud snapshot returned duplicate property ${key}.`),
      );
    } else {
      resultMap.set(key, result);
    }
  }

  return {resultMap, resultErrorMap, errors};
}

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
  TName extends 'onStateChanged' | 'onPropertyChanged' | 'onEventOccurred',
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

function publishObserverState(
  entry: CloudDeviceObserverEntry,
  state: CloudDeviceState,
): void {
  if (entry.initialized) {
    callObserver(entry.observer, 'onStateChanged', state);
    return;
  }

  entry.observer.onStateChanged?.(state);
  entry.initialized = true;
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

type PromiseOutcome<T> =
  | {readonly status: 'fulfilled'; readonly value: T}
  | {readonly status: 'rejected'; readonly reason: unknown};
