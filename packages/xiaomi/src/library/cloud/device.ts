import type {MiotProperty} from '../miot/index.js';

import {CLOUD_MQTT_RECONNECT_INTERVAL} from './constants.js';
import type {
  CloudMqttDeviceMessage,
  CloudMqttDeviceMessageHandler,
} from './mqtt.js';

export class CloudDeviceChannel {
  private readonly listenerEntrySet = new Set<CloudDeviceListenerEntry>();

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

  private stateRefreshRequest: CloudDeviceStateRefreshRequest | undefined;

  private brokerConnected = true;

  private stateRefreshPromise: Promise<void> | undefined;

  private stateRefreshRetryTimeout: ReturnType<typeof setTimeout> | undefined;

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
    listener: CloudDeviceListener,
  ): Promise<CloudDeviceSubscription> {
    const listenerEntry: CloudDeviceListenerEntry = {
      propertyMap: createPropertyMap(this.did, properties),
      listener,
      initialized: false,
    };

    this.listenerEntrySet.add(listenerEntry);

    try {
      await this.ensureSubscribed();

      if (!listenerEntry.initialized) {
        if (listenerEntry.refreshOperation === undefined) {
          void this.refreshEntries([listenerEntry]).catch(() => undefined);
        }

        await this.waitForEntryRefresh(listenerEntry);
      }

      if (!listenerEntry.initialized) {
        throw new Error(`Cloud device ${this.did} state was not initialized.`);
      }
    } catch (error) {
      await this.removeListener(listenerEntry);
      throw error;
    }

    let disposed = false;

    return {
      refresh: async () => {
        if (disposed) {
          throw new Error(`Cloud device subscription ${this.did} is disposed.`);
        }

        void this.refreshEntries([listenerEntry]).catch(() => undefined);
        await this.waitForEntryRefresh(listenerEntry);
      },
      dispose: async () => {
        if (disposed) {
          return;
        }

        disposed = true;
        await this.removeListener(listenerEntry);
      },
    };
  }

  handleConnectionState(connected: boolean): void {
    if (!connected) {
      this.stateGeneration++;
      this.brokerConnected = false;
      this.requestStateRefresh();
      return;
    }

    this.brokerConnected = true;
    this.startStateRefresh();
  }

  private requestStateRefresh(onlineOverride?: boolean): void {
    this.stateRefreshRequest = {onlineOverride};
    this.stopStateRefresh();
    this.startStateRefresh();
  }

  private startStateRefresh(): void {
    const request = this.stateRefreshRequest;

    if (
      request === undefined ||
      !this.brokerConnected ||
      this.listenerEntrySet.size === 0 ||
      this.stateRefreshPromise !== undefined ||
      this.stateRefreshRetryTimeout !== undefined
    ) {
      return;
    }

    const entries = [...this.listenerEntrySet];

    void this.refreshEntries(entries, request.onlineOverride).catch(
      () => undefined,
    );

    const promise = Promise.all(
      entries.map(entry => this.waitForEntryRefresh(entry)),
    ).then(() => undefined);
    this.stateRefreshPromise = promise;

    void promise.then(
      () => {
        if (this.stateRefreshPromise !== promise) {
          return;
        }

        this.stateRefreshPromise = undefined;

        if (this.stateRefreshRequest === request) {
          this.stateRefreshRequest = undefined;
        }
      },
      error => {
        if (this.stateRefreshPromise !== promise) {
          return;
        }

        this.stateRefreshPromise = undefined;

        if (
          this.stateRefreshRequest !== request ||
          !this.brokerConnected ||
          this.listenerEntrySet.size === 0
        ) {
          return;
        }

        this.notifyError(error);
        this.scheduleStateRefresh();
      },
    );
  }

  private scheduleStateRefresh(): void {
    if (
      this.stateRefreshRetryTimeout !== undefined ||
      this.stateRefreshRequest === undefined ||
      !this.brokerConnected ||
      this.listenerEntrySet.size === 0
    ) {
      return;
    }

    this.stateRefreshRetryTimeout = setTimeout(() => {
      this.stateRefreshRetryTimeout = undefined;
      this.startStateRefresh();
    }, CLOUD_MQTT_RECONNECT_INTERVAL);
  }

  private stopStateRefresh(): void {
    this.stateRefreshPromise = undefined;

    if (this.stateRefreshRetryTimeout !== undefined) {
      clearTimeout(this.stateRefreshRetryTimeout);
      this.stateRefreshRetryTimeout = undefined;
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
    requestedEntries: readonly CloudDeviceListenerEntry[],
    onlineOverride?: boolean,
  ): Promise<void> {
    const entries = requestedEntries.filter(entry =>
      this.listenerEntrySet.has(entry),
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
    entry: CloudDeviceListenerEntry,
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

      if (!this.listenerEntrySet.has(entry)) {
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
    entries: readonly CloudDeviceListenerEntry[],
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

    const successfulEntries: CloudDeviceListenerEntry[] = [];
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
          publishListenerState(entry, {
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
    entries: readonly CloudDeviceListenerEntry[],
    refreshToken: object,
    generation: number,
  ): CloudDeviceListenerEntry[] {
    if (generation !== this.stateGeneration) {
      return [];
    }

    return entries.filter(
      entry =>
        this.listenerEntrySet.has(entry) &&
        entry.refreshOperation?.token === refreshToken,
    );
  }

  private isRefreshCurrent(
    entries: readonly CloudDeviceListenerEntry[],
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
    entries: readonly CloudDeviceListenerEntry[],
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
        publishListenerState(entry, {did: this.did, online, properties});
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

      for (const entry of this.listenerEntrySet) {
        if (entry.initialized && entry.propertyMap.has(key)) {
          callListener(entry.listener, 'onPropertyChanged', update);
        }
      }
    } else if (message.type === 'event') {
      const event: CloudEvent = {
        did: message.did,
        siid: message.siid,
        eiid: message.eiid,
        arguments: message.arguments,
      };

      for (const {listener} of this.listenerEntrySet) {
        callListener(listener, 'onEventOccurred', event);
      }
    } else {
      this.stateGeneration++;
      this.requestStateRefresh(message.online);
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

  private async removeListener(
    listenerEntry: CloudDeviceListenerEntry,
  ): Promise<void> {
    if (!this.listenerEntrySet.delete(listenerEntry)) {
      return;
    }

    listenerEntry.refreshOperation?.replace();
    listenerEntry.refreshOperation = undefined;

    const subscribePromise = this.subscribePromise;

    if (subscribePromise !== undefined) {
      await subscribePromise.catch(() => undefined);
    }

    if (this.listenerEntrySet.size > 0) {
      return;
    }

    this.stateRefreshRequest = undefined;
    this.stopStateRefresh();

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

      if (this.listenerEntrySet.size === 0) {
        this.onEmpty();
      }
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
    for (const {listener} of this.listenerEntrySet) {
      notifyListenerError(listener, error);
    }
  }
}

export type CloudDeviceSubscription = {
  refresh(): Promise<void>;
  dispose(): Promise<void>;
};

export type CloudDeviceListener = {
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

type CloudDeviceListenerEntry = {
  readonly propertyMap: ReadonlyMap<string, MiotProperty>;
  readonly listener: CloudDeviceListener;
  initialized: boolean;
  refreshOperation?: CloudDeviceRefreshOperation;
};

type CloudDeviceStateRefreshRequest = {
  readonly onlineOverride: boolean | undefined;
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
  entries: readonly CloudDeviceListenerEntry[],
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
        `Cloud device ${did} cannot subscribe to property for ${property.did}.`,
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

function callListener<TName extends 'onPropertyChanged' | 'onEventOccurred'>(
  listener: CloudDeviceListener,
  name: TName,
  value: Parameters<NonNullable<CloudDeviceListener[TName]>>[0],
): void {
  const callback = listener[name] as
    | ((value: Parameters<NonNullable<CloudDeviceListener[TName]>>[0]) => void)
    | undefined;

  if (callback === undefined) {
    return;
  }

  try {
    callback(value);
  } catch (error) {
    notifyListenerError(listener, error);
  }
}

function publishListenerState(
  entry: CloudDeviceListenerEntry,
  state: CloudDeviceState,
): void {
  entry.listener.onStateChanged?.(state);
  entry.initialized = true;
}

function notifyListenerError(
  listener: CloudDeviceListener,
  error: unknown,
): void {
  if (listener.onError === undefined) {
    console.error(error);
    return;
  }

  try {
    listener.onError(error);
  } catch (listenerError) {
    console.error(listenerError);
  }
}

type PromiseOutcome<T> =
  | {readonly status: 'fulfilled'; readonly value: T}
  | {readonly status: 'rejected'; readonly reason: unknown};
