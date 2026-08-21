import type {
  MiotEvent,
  MiotEventArguments,
  MiotProperty,
} from '../miot/index.js';

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

  private readonly snapshotRetryEntrySet = new Set<CloudDeviceListenerEntry>();

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

  subscribe(
    properties: readonly MiotProperty[],
    listener: CloudDeviceListener,
  ): Promise<CloudDeviceSubscription>;
  subscribe(
    request: CloudDeviceSubscriptionRequest,
    listener: CloudDeviceListener,
  ): Promise<CloudDeviceSubscription>;
  async subscribe(
    requestOrProperties:
      CloudDeviceSubscriptionRequest | readonly MiotProperty[],
    listener: CloudDeviceListener,
  ): Promise<CloudDeviceSubscription> {
    const request = normalizeSubscriptionRequest(requestOrProperties);
    const {propertyChangeMap, eventKeySet} = createNotificationTargetMaps(
      this.did,
      request.notifications ?? [],
    );
    const snapshotPropertyMap = createPropertyMap(
      this.did,
      request.snapshotProperties,
    );
    const cloudPreferredSnapshotPropertyKeySet = new Set(
      createPropertyMap(
        this.did,
        request.cloudPreferredSnapshotProperties ?? [],
      ).keys(),
    );
    const replaySnapshotPropertyNotificationKeySet = new Set(
      createPropertyMap(
        this.did,
        request.replaySnapshotPropertyNotifications ?? [],
      ).keys(),
    );
    const refreshSnapshotOnEventKeySet = createEventKeySet(
      this.did,
      request.refreshSnapshotOnEvents ?? [],
    );

    for (const key of replaySnapshotPropertyNotificationKeySet) {
      if (!snapshotPropertyMap.has(key) || !propertyChangeMap.has(key)) {
        throw new TypeError(
          `Cloud device ${this.did} can only replay subscribed snapshot property notifications.`,
        );
      }
    }

    for (const key of cloudPreferredSnapshotPropertyKeySet) {
      if (!snapshotPropertyMap.has(key)) {
        throw new TypeError(
          `Cloud device ${this.did} can only prefer cloud state for snapshot properties.`,
        );
      }
    }

    if (
      refreshSnapshotOnEventKeySet.size > 0 &&
      snapshotPropertyMap.size === 0
    ) {
      throw new TypeError(
        `Cloud device ${this.did} cannot refresh an empty snapshot on events.`,
      );
    }

    for (const key of refreshSnapshotOnEventKeySet) {
      if (!eventKeySet.has(key)) {
        throw new TypeError(
          `Cloud device ${this.did} can only refresh snapshots for subscribed events.`,
        );
      }
    }

    const listenerEntry: CloudDeviceListenerEntry = {
      snapshotPropertyMap,
      cloudPreferredSnapshotPropertyKeySet,
      propertyChangeMap,
      eventKeySet,
      replaySnapshotPropertyNotificationKeySet,
      refreshSnapshotOnEventKeySet,
      listener,
      initialized: false,
      bufferingNotifications: true,
      pendingNotifications: [],
      deliveredSnapshotPropertyKeySet: new Set(),
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

      for (const entry of this.listenerEntrySet) {
        entry.pendingNotifications.length = 0;
      }

      this.requestStateRefresh();
      return;
    }

    this.brokerConnected = true;
    this.startStateRefresh();
  }

  private requestStateRefresh(onlineOverride?: boolean): void {
    this.stateRefreshRequest = {type: 'state', onlineOverride};
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

    const entries =
      request.type === 'snapshot-retry'
        ? [...this.snapshotRetryEntrySet].filter(entry =>
            this.listenerEntrySet.has(entry),
          )
        : [...this.listenerEntrySet];

    if (entries.length === 0) {
      this.stateRefreshRequest = undefined;
      return;
    }

    void this.refreshEntries(entries, {
      onlineOverride: request.onlineOverride,
      reportFailuresToListeners: true,
    }).catch(() => undefined);

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

        if (this.stateRefreshRequest !== request) {
          this.scheduleStateRefresh();
          return;
        }

        if (this.snapshotRetryEntrySet.size === 0) {
          this.stateRefreshRequest = undefined;
        } else {
          this.stateRefreshRequest = {
            type: 'snapshot-retry',
            onlineOverride: undefined,
          };
          this.scheduleStateRefresh();
        }
      },
      () => {
        if (this.stateRefreshPromise !== promise) {
          return;
        }

        this.stateRefreshPromise = undefined;

        if (
          this.stateRefreshRequest === undefined ||
          !this.brokerConnected ||
          this.listenerEntrySet.size === 0
        ) {
          return;
        }

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

  private updateSnapshotRetry(
    entry: CloudDeviceListenerEntry,
    retry: boolean,
  ): void {
    if (!this.listenerEntrySet.has(entry)) {
      return;
    }

    if (retry) {
      this.snapshotRetryEntrySet.add(entry);
    } else {
      this.snapshotRetryEntrySet.delete(entry);
    }

    if (this.snapshotRetryEntrySet.size === 0) {
      if (this.stateRefreshRequest?.type === 'snapshot-retry') {
        this.stateRefreshRequest = undefined;

        if (this.stateRefreshRetryTimeout !== undefined) {
          clearTimeout(this.stateRefreshRetryTimeout);
          this.stateRefreshRetryTimeout = undefined;
        }
      }

      return;
    }

    if (this.online === false || !this.brokerConnected) {
      return;
    }

    if (this.stateRefreshRequest === undefined) {
      this.stateRefreshRequest = {
        type: 'snapshot-retry',
        onlineOverride: undefined,
      };
    }

    if (this.stateRefreshPromise === undefined) {
      this.scheduleStateRefresh();
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
    options: CloudDeviceRefreshOptions = {},
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
    const internalPromise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    for (const entry of entries) {
      entry.refreshOperation?.replace();
      retainRefreshIndependentNotifications(entry);
      entry.bufferingNotifications = true;
      const entryPromise = internalPromise.catch(error => {
        const failure = normalizeRefreshFailure(error, entries);

        if (failure.failedEntrySet.has(entry)) {
          throw failure.getEntryReason(entry);
        }
      });
      void entryPromise.catch(() => undefined);
      entry.refreshOperation = createRefreshOperation(token, entryPromise);
    }

    void this.readAndPublishState(
      entries,
      token,
      sequence,
      options.onlineOverride,
      options.propertyReadPriority ?? 'normal',
    ).then(resolvePromise, error => {
      const failure = normalizeRefreshFailure(error, entries);

      for (const entry of entries) {
        const current =
          this.listenerEntrySet.has(entry) &&
          entry.refreshOperation?.token === token;
        const invalidateSnapshot =
          current &&
          failure.failedEntrySet.has(entry) &&
          entry.initialized &&
          entry.bufferingNotifications &&
          hasPendingSnapshotRefreshEvent(entry);

        if (invalidateSnapshot) {
          invalidateDeliveredEntrySnapshot(entry);
        }

        if (current && failure.failedEntrySet.has(entry)) {
          recoverEntryNotifications(entry, token);

          if (options.reportFailuresToListeners === true) {
            notifyListenerError(entry.listener, failure.getEntryReason(entry));
          }
        }
      }

      rejectPromise(failure);
    });

    return internalPromise.catch(error => {
      throw normalizeRefreshFailure(error, entries).reason;
    });
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
    propertyReadPriority: CloudPropertyReadPriority,
  ): Promise<void> {
    const propertyMap = createEntryPropertyMap(entries);
    const cloudPreferredPropertyKeySet = new Set(
      entries.flatMap(entry => [...entry.cloudPreferredSnapshotPropertyKeySet]),
    );
    const cloudPreferredProperties = [...propertyMap].flatMap(
      ([key, property]) =>
        cloudPreferredPropertyKeySet.has(key) ? [property] : [],
    );
    const propertyBaselineMap = this.captureRevisions(propertyMap);
    const replaySnapshotPropertyNotificationKeySet = new Set(
      entries.flatMap(entry => [
        ...entry.replaySnapshotPropertyNotificationKeySet,
      ]),
    );
    const replaySnapshotRevisionMap = new Map(
      [...replaySnapshotPropertyNotificationKeySet].map(key => [
        key,
        ++this.revision,
      ]),
    );
    const generation = this.stateGeneration;
    const propertyRead = settlePromise(
      onlineOverride === false || propertyMap.size === 0
        ? Promise.resolve([])
        : Promise.resolve().then(() =>
            this.readProperties(
              [...propertyMap.values()],
              cloudPreferredProperties,
              propertyReadPriority,
            ),
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
      this.publishState(currentEntries, false, new Map(), refreshToken);
      return;
    }

    const entryErrorMap = new Map<CloudDeviceListenerEntry, unknown>();
    const notificationOnlyEntries = currentEntries.filter(
      entry => entry.snapshotPropertyMap.size === 0,
    );

    if (notificationOnlyEntries.length > 0) {
      this.commitRefreshOnline(true, refreshSequence);

      for (const entry of notificationOnlyEntries) {
        try {
          publishListenerState(entry, {
            did: this.did,
            online: true,
            properties: [],
          });
          replayEntryNotifications(entry, refreshToken);
          this.updateSnapshotRetry(entry, false);
        } catch (error) {
          entryErrorMap.set(entry, error);
        }
      }
    }

    currentEntries = currentEntries.filter(
      entry => entry.snapshotPropertyMap.size > 0,
    );

    if (currentEntries.length === 0) {
      throwEntryRefreshErrors(entryErrorMap);
      return;
    }

    const propertyOutcome = await propertyRead;

    currentEntries = this.getCurrentRefreshEntries(
      currentEntries,
      refreshToken,
      generation,
    );

    if (currentEntries.length === 0) {
      throwEntryRefreshErrors(entryErrorMap);
      return;
    }

    online = this.resolveRefreshOnline(requestedOnline, refreshSequence);

    if (!online) {
      this.publishState(currentEntries, false, new Map(), refreshToken);
      throwEntryRefreshErrors(entryErrorMap);
      return;
    }

    const wholePropertyReadFailed = propertyOutcome.status === 'rejected';
    const wholePropertyReadError =
      propertyOutcome.status === 'rejected'
        ? propertyOutcome.reason
        : undefined;
    const {
      resultMap,
      resultErrorMap,
      errors: protocolErrors,
    } = propertyOutcome.status === 'fulfilled'
      ? collectSnapshotResults(this.did, propertyMap, propertyOutcome.value)
      : {
          resultMap: new Map<string, CloudPropertySnapshot>(),
          resultErrorMap: new Map<string, Error>(),
          errors: [],
        };
    const currentPropertyMap = createEntryPropertyMap(currentEntries);
    const snapshotReadFailedPropertyKeySet = new Set(
      [...currentPropertyMap.keys()].filter(key => {
        if (wholePropertyReadFailed || resultErrorMap.has(key)) {
          return true;
        }

        const result = resultMap.get(key);

        return (
          result === undefined ||
          (result.code !== 0 && result.code !== 1) ||
          !Object.hasOwn(result, 'value')
        );
      }),
    );

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
        if (
          cachedRefreshSequence > refreshSequence ||
          cachedProperty.source !== 'mqtt' ||
          !replaySnapshotPropertyNotificationKeySet.has(key)
        ) {
          continue;
        }
      }

      if (wholePropertyReadFailed) {
        propertyErrorMap.set(key, wholePropertyReadError);
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

    const entryAvailablePropertyKeyMap = new Map<
      CloudDeviceListenerEntry,
      ReadonlySet<string>
    >();
    const entryUnavailableSnapshotPropertyKeyMap = new Map<
      CloudDeviceListenerEntry,
      ReadonlySet<string>
    >();
    const entryFailedSnapshotPropertyKeyMap = new Map<
      CloudDeviceListenerEntry,
      ReadonlySet<string>
    >();
    const hasFreshCachedProperty = (key: string): boolean => {
      const baseline = propertyBaselineMap.get(key) ?? 0;
      const currentRevision = this.propertyRevisionMap.get(key) ?? 0;
      const cachedProperty = this.propertyCacheMap.get(key);
      const cachedRefreshSequence =
        this.propertyRefreshSequenceMap.get(key) ?? 0;

      return (
        currentRevision !== baseline &&
        cachedProperty !== undefined &&
        (cachedProperty.source === 'mqtt' ||
          cachedRefreshSequence > refreshSequence)
      );
    };

    for (const entry of currentEntries) {
      const availablePropertyKeySet = new Set<string>();
      const unavailableSnapshotPropertyKeySet = new Set<string>();
      const failedSnapshotPropertyKeySet = new Set<string>();

      for (const key of entry.snapshotPropertyMap.keys()) {
        const cachedProperty = this.propertyCacheMap.get(key);
        const cachedRefreshSequence =
          this.propertyRefreshSequenceMap.get(key) ?? 0;
        const preserveSupersededSelectedNotification =
          entry.replaySnapshotPropertyNotificationKeySet.has(key) &&
          cachedProperty?.source === 'mqtt' &&
          cachedRefreshSequence > refreshSequence &&
          hasPendingSnapshotPropertyNotification(
            entry,
            key,
            propertyBaselineMap.get(key) ?? 0,
          );

        if (preserveSupersededSelectedNotification) {
          unavailableSnapshotPropertyKeySet.add(key);

          if (snapshotReadFailedPropertyKeySet.has(key)) {
            failedSnapshotPropertyKeySet.add(key);
          }

          continue;
        }

        if (
          propertyErrorMap.has(key) &&
          (!hasFreshCachedProperty(key) ||
            entry.replaySnapshotPropertyNotificationKeySet.has(key))
        ) {
          unavailableSnapshotPropertyKeySet.add(key);
          failedSnapshotPropertyKeySet.add(key);
          continue;
        }

        availablePropertyKeySet.add(key);
      }

      entryAvailablePropertyKeyMap.set(entry, availablePropertyKeySet);
      entryUnavailableSnapshotPropertyKeyMap.set(
        entry,
        unavailableSnapshotPropertyKeySet,
      );
      entryFailedSnapshotPropertyKeyMap.set(
        entry,
        failedSnapshotPropertyKeySet,
      );
    }

    const availablePropertyKeySet = new Set(
      [...entryAvailablePropertyKeyMap.values()].flatMap(keys => [...keys]),
    );
    const replayedSnapshotUpdateMap = new Map<string, CloudPropertyUpdate>();

    for (const [key, update] of propertyUpdateMap) {
      if (availablePropertyKeySet.has(key)) {
        const baseline = propertyBaselineMap.get(key) ?? 0;
        const currentRevision = this.propertyRevisionMap.get(key) ?? 0;
        const cachedProperty = this.propertyCacheMap.get(key);
        let snapshotUpdate: CloudPropertyUpdate;

        if (
          replaySnapshotPropertyNotificationKeySet.has(key) &&
          currentRevision !== baseline &&
          cachedProperty?.source === 'mqtt'
        ) {
          snapshotUpdate = {
            ...update.property,
            value: update.value,
            revision: replaySnapshotRevisionMap.get(key) ?? ++this.revision,
            source: 'snapshot',
          };
          this.propertyRefreshSequenceMap.set(key, refreshSequence);
        } else {
          snapshotUpdate = this.cacheProperty(
            update.property,
            update.value,
            'snapshot',
            refreshSequence,
          );
        }

        if (replaySnapshotPropertyNotificationKeySet.has(key)) {
          replayedSnapshotUpdateMap.set(key, snapshotUpdate);
        }
      }
    }

    if (entryAvailablePropertyKeyMap.size > 0) {
      this.commitRefreshOnline(true, refreshSequence);

      for (const [
        entry,
        availablePropertyKeySet,
      ] of entryAvailablePropertyKeyMap) {
        const properties = [...entry.snapshotPropertyMap.keys()].flatMap(
          key => {
            if (!availablePropertyKeySet.has(key)) {
              return [];
            }

            const property = entry.replaySnapshotPropertyNotificationKeySet.has(
              key,
            )
              ? (replayedSnapshotUpdateMap.get(key) ??
                this.propertyCacheMap.get(key))
              : this.propertyCacheMap.get(key);

            if (property === undefined) {
              throw new TypeError(
                `Cloud device state is missing property ${key}.`,
              );
            }

            return [property];
          },
        );
        const invalidatedProperties = [...entry.snapshotPropertyMap].flatMap(
          ([key, property]) => {
            return entry.deliveredSnapshotPropertyKeySet.has(key) &&
              !availablePropertyKeySet.has(key)
              ? [property]
              : [];
          },
        );
        const failedSnapshotPropertyKeySet =
          entryFailedSnapshotPropertyKeyMap.get(entry) ?? new Set<string>();
        const unavailableSnapshotPropertyKeySet =
          entryUnavailableSnapshotPropertyKeyMap.get(entry) ??
          new Set<string>();

        try {
          // Snapshot-backed notifications already present in the cache are
          // represented by the state published below. Remove only those that
          // arrived before callbacks; a synchronous invalidation or state
          // listener may enqueue newer notifications, which must still be
          // replayed.
          retainPostSnapshotNotifications(
            entry,
            replayedSnapshotUpdateMap,
            propertyBaselineMap,
            unavailableSnapshotPropertyKeySet,
          );

          publishListenerState(entry, {
            did: this.did,
            online: true,
            properties,
            ...(invalidatedProperties.length === 0
              ? {}
              : {invalidatedProperties}),
          });
          replayEntryNotifications(entry, refreshToken);
          this.updateSnapshotRetry(
            entry,
            wholePropertyReadFailed || failedSnapshotPropertyKeySet.size > 0,
          );

          if (wholePropertyReadFailed) {
            notifyListenerError(entry.listener, wholePropertyReadError);
          }
        } catch (error) {
          entryErrorMap.set(entry, error);
        }
      }
    }

    for (const entry of currentEntries) {
      const duplicateErrorSet = new Set(
        [...entry.snapshotPropertyMap.keys()].flatMap(key => {
          const error = resultErrorMap.get(key);
          return error === undefined ? [] : [error];
        }),
      );

      for (const error of duplicateErrorSet) {
        notifyListenerError(entry.listener, error);
      }
    }

    for (const error of protocolErrors) {
      for (const entry of currentEntries) {
        notifyListenerError(entry.listener, error);
      }
    }

    throwEntryRefreshErrors(entryErrorMap);
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
    refreshToken: object,
  ): void {
    const entryErrorMap = new Map<CloudDeviceListenerEntry, unknown>();

    for (const entry of entries) {
      const properties = [...entry.snapshotPropertyMap.keys()].flatMap(key => {
        const property = propertyMap.get(key);
        return property === undefined ? [] : [property];
      });

      try {
        publishListenerState(entry, {did: this.did, online, properties});
        this.updateSnapshotRetry(entry, false);
      } catch (error) {
        entryErrorMap.set(entry, error);
      } finally {
        discardEntryNotifications(entry, refreshToken);
      }
    }

    throwEntryRefreshErrors(entryErrorMap);
  }

  private handleMessage(message: CloudMqttDeviceMessage): void {
    if (message.data.did !== this.did) {
      this.notifyError(
        new Error(`Cloud MQTT routed unexpected device ${message.data.did}.`),
      );
      return;
    }

    if (message.type === 'property-change') {
      const {data} = message;
      const update = this.cacheProperty(
        {did: data.did, siid: data.siid, piid: data.piid},
        data.value,
        'mqtt',
      );
      const key = getPropertyKey(update);
      const notification: CloudDeviceNotification = {
        type: 'property-change',
        data: update,
      };

      for (const entry of this.listenerEntrySet) {
        if (entry.propertyChangeMap.has(key)) {
          queueOrDispatchEntryNotification(entry, notification);
        }
      }
    } else if (message.type === 'event') {
      const {data} = message;
      const event: CloudEvent = {
        did: data.did,
        siid: data.siid,
        eiid: data.eiid,
        arguments: data.arguments,
      };
      const key = getEventKey(event);
      const notification: CloudDeviceNotification = {
        type: 'event',
        data: event,
      };
      const refreshEntries: CloudDeviceListenerEntry[] = [];

      for (const entry of this.listenerEntrySet) {
        if (entry.eventKeySet.has(key)) {
          if (entry.refreshSnapshotOnEventKeySet.has(key)) {
            entry.pendingNotifications.push(notification);
            refreshEntries.push(entry);
          } else {
            queueOrDispatchEntryNotification(entry, notification);
          }
        }
      }

      if (refreshEntries.length > 0) {
        void this.refreshEntries(refreshEntries, {
          onlineOverride: true,
          propertyReadPriority: 'event',
          reportFailuresToListeners: true,
        }).catch(() => undefined);
      }
    } else {
      this.stateGeneration++;
      this.requestStateRefresh(message.data.online);
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

    this.snapshotRetryEntrySet.delete(listenerEntry);
    listenerEntry.refreshOperation?.replace();
    listenerEntry.refreshOperation = undefined;

    const subscribePromise = this.subscribePromise;

    if (subscribePromise !== undefined) {
      await subscribePromise.catch(() => undefined);
    }

    if (this.listenerEntrySet.size > 0) {
      if (
        this.snapshotRetryEntrySet.size === 0 &&
        this.stateRefreshRequest?.type === 'snapshot-retry'
      ) {
        this.stateRefreshRequest = undefined;
        this.stopStateRefresh();
      }

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

export type CloudDeviceSubscriptionRequest = {
  /**
   * Properties observed in each state snapshot when available. Snapshot
   * failures do not prevent the subscription from initializing or refreshing.
   */
  readonly snapshotProperties: readonly MiotProperty[];
  /** Snapshot properties that prefer cloud state before local fallback. */
  readonly cloudPreferredSnapshotProperties?: readonly MiotProperty[];
  /**
   * Incremental device notifications to receive after each snapshot. Realtime
   * notifications received while a refresh is in flight are buffered per
   * listener. Snapshot-backed property changes are absorbed into the published
   * state; events and notification-only property changes are replayed in
   * arrival order afterward.
   */
  readonly notifications?: readonly CloudDeviceNotificationTarget[];
  /**
   * Subscribed events that refresh the complete snapshot before the event is
   * delivered. Every event must also appear in {@link notifications}, and the
   * subscription must contain at least one snapshot property.
   */
  readonly refreshSnapshotOnEvents?: readonly MiotEvent[];
  /**
   * Snapshot properties whose buffered property-change notifications must be
   * replayed after the snapshot instead of being absorbed into it. Each entry
   * must also appear in both {@link snapshotProperties} and
   * {@link notifications}.
   */
  readonly replaySnapshotPropertyNotifications?: readonly MiotProperty[];
};

export type CloudDeviceNotificationTarget =
  | {readonly type: 'property-change'; readonly data: MiotProperty}
  | {readonly type: 'event'; readonly data: MiotEvent};

export type CloudDeviceListener = {
  readonly onStateChanged?: (state: CloudDeviceState) => void;
  /** Invalidates snapshot properties whose current values are unavailable. */
  readonly onSnapshotInvalidated?: (
    properties: readonly MiotProperty[],
  ) => void;
  readonly onNotification?: (notification: CloudDeviceNotification) => void;
  /** @deprecated Use {@link onNotification}. */
  readonly onPropertyChanged?: (update: CloudPropertyUpdate) => void;
  /** @deprecated Use {@link onNotification}. */
  readonly onEventOccurred?: (event: CloudEvent) => void;
  readonly onError?: (error: unknown) => void;
};

export type CloudDeviceState = {
  readonly did: string;
  readonly online: boolean;
  readonly properties: readonly CloudPropertyUpdate[];
  /** Previously delivered snapshot properties invalidated by this state. */
  readonly invalidatedProperties?: readonly MiotProperty[];
};

export type CloudPropertyUpdate = MiotProperty & {
  readonly value: unknown;
  readonly revision: number;
  readonly source: CloudPropertyUpdateSource;
};

export type CloudPropertyUpdateSource = 'snapshot' | 'mqtt';

export type CloudDeviceNotification =
  | {readonly type: 'property-change'; readonly data: CloudPropertyUpdate}
  | {readonly type: 'event'; readonly data: CloudEvent};

export type CloudEvent = {
  readonly did: string;
  readonly siid: number;
  readonly eiid: number;
  readonly arguments: MiotEventArguments;
};

export type CloudPropertySnapshot = MiotProperty & {
  readonly value?: unknown;
  readonly code: number;
};

export type CloudPropertyReader = (
  properties: readonly MiotProperty[],
  cloudPreferredProperties: readonly MiotProperty[],
  priority: CloudPropertyReadPriority,
) => Promise<readonly CloudPropertySnapshot[]>;

export type CloudPropertyReadPriority = 'normal' | 'event';

export type CloudOnlineReader = () => Promise<boolean>;

export type CloudDeviceMessageSource = {
  subscribeDevice(
    did: string,
    handler: CloudMqttDeviceMessageHandler,
  ): Promise<void>;
  unsubscribeDevice(did: string): Promise<void>;
};

type CloudDeviceListenerEntry = {
  readonly snapshotPropertyMap: ReadonlyMap<string, MiotProperty>;
  readonly cloudPreferredSnapshotPropertyKeySet: ReadonlySet<string>;
  readonly propertyChangeMap: ReadonlyMap<string, MiotProperty>;
  readonly eventKeySet: ReadonlySet<string>;
  readonly replaySnapshotPropertyNotificationKeySet: ReadonlySet<string>;
  readonly refreshSnapshotOnEventKeySet: ReadonlySet<string>;
  readonly listener: CloudDeviceListener;
  readonly pendingNotifications: CloudDeviceNotification[];
  readonly deliveredSnapshotPropertyKeySet: Set<string>;
  initialized: boolean;
  bufferingNotifications: boolean;
  refreshOperation?: CloudDeviceRefreshOperation;
};

type CloudDeviceStateRefreshRequest = {
  readonly type: 'state' | 'snapshot-retry';
  readonly onlineOverride: boolean | undefined;
};

type CloudDeviceRefreshOptions = {
  readonly onlineOverride?: boolean | undefined;
  readonly propertyReadPriority?: CloudPropertyReadPriority;
  readonly reportFailuresToListeners?: boolean;
};

type CloudDeviceRefreshOperation = {
  readonly token: object;
  readonly promise: Promise<void>;
  readonly replaced: Promise<void>;
  replace(): void;
};

class CloudDeviceRefreshFailure {
  readonly failedEntrySet: ReadonlySet<CloudDeviceListenerEntry>;

  constructor(
    readonly reason: unknown,
    private readonly entryReasonMap: ReadonlyMap<
      CloudDeviceListenerEntry,
      unknown
    >,
  ) {
    this.failedEntrySet = new Set(entryReasonMap.keys());
  }

  getEntryReason(entry: CloudDeviceListenerEntry): unknown {
    return this.entryReasonMap.get(entry) ?? this.reason;
  }
}

function createRefreshFailure(
  reason: unknown,
  entryReasonMap: ReadonlyMap<CloudDeviceListenerEntry, unknown>,
): CloudDeviceRefreshFailure {
  return new CloudDeviceRefreshFailure(reason, entryReasonMap);
}

function normalizeRefreshFailure(
  error: unknown,
  entries: readonly CloudDeviceListenerEntry[],
): CloudDeviceRefreshFailure {
  if (error instanceof CloudDeviceRefreshFailure) {
    return error;
  }

  return createRefreshFailure(
    error,
    new Map(entries.map(entry => [entry, error] as const)),
  );
}

function throwEntryRefreshErrors(
  entryErrorMap: ReadonlyMap<CloudDeviceListenerEntry, unknown>,
): void {
  const firstError = entryErrorMap.values().next().value as unknown;

  if (entryErrorMap.size > 0) {
    throw createRefreshFailure(firstError, entryErrorMap);
  }
}

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
    for (const [key, property] of entry.snapshotPropertyMap) {
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
      const error = new Error(
        `Cloud snapshot returned duplicate property ${key}.`,
      );
      resultMap.delete(key);
      resultErrorMap.set(key, error);
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

function createNotificationTargetMaps(
  did: string,
  targets: readonly CloudDeviceNotificationTarget[],
): {
  readonly propertyChangeMap: ReadonlyMap<string, MiotProperty>;
  readonly eventKeySet: ReadonlySet<string>;
} {
  const properties: MiotProperty[] = [];
  const events: MiotEvent[] = [];

  for (const target of targets) {
    if (target.type === 'property-change') {
      properties.push(target.data);
    } else {
      events.push(target.data);
    }
  }

  return {
    propertyChangeMap: createPropertyMap(did, properties),
    eventKeySet: createEventKeySet(did, events),
  };
}

function getPropertyKey(property: {
  readonly siid: number;
  readonly piid: number;
}): string {
  return `${property.siid}.${property.piid}`;
}

function createEventKeySet(
  did: string,
  events: readonly MiotEvent[],
): Set<string> {
  const eventKeySet = new Set<string>();

  for (const event of events) {
    if (event.did !== did) {
      throw new Error(
        `Cloud device ${did} cannot subscribe to event for ${event.did}.`,
      );
    }

    eventKeySet.add(getEventKey(event));
  }

  return eventKeySet;
}

function getEventKey(event: {
  readonly siid: number;
  readonly eiid: number;
}): string {
  return `${event.siid}.${event.eiid}`;
}

function callListenerCallback<T>(
  listener: CloudDeviceListener,
  callback: ((value: T) => void) | undefined,
  value: T,
): void {
  try {
    callback?.(value);
  } catch (error) {
    notifyListenerError(listener, error);
  }
}

function queueOrDispatchEntryNotification(
  entry: CloudDeviceListenerEntry,
  notification: CloudDeviceNotification,
): void {
  if (entry.bufferingNotifications || !entry.initialized) {
    entry.pendingNotifications.push(notification);
    return;
  }

  dispatchListenerNotification(entry, notification);
}

function replayEntryNotifications(
  entry: CloudDeviceListenerEntry,
  refreshToken: object,
): void {
  while (
    entry.refreshOperation?.token === refreshToken &&
    entry.pendingNotifications.length > 0
  ) {
    const notifications = entry.pendingNotifications.splice(0);

    for (const [index, notification] of notifications.entries()) {
      if (entry.refreshOperation?.token !== refreshToken) {
        carryRefreshIndependentNotifications(entry, notifications.slice(index));
        return;
      }

      dispatchListenerNotification(entry, notification);
    }
  }

  if (entry.refreshOperation?.token === refreshToken) {
    entry.bufferingNotifications = false;
  }
}

function recoverEntryNotifications(
  entry: CloudDeviceListenerEntry,
  refreshToken: object,
): void {
  if (
    entry.refreshOperation?.token !== refreshToken ||
    !entry.initialized ||
    !entry.bufferingNotifications
  ) {
    return;
  }

  while (
    entry.refreshOperation?.token === refreshToken &&
    entry.pendingNotifications.length > 0
  ) {
    const notifications = entry.pendingNotifications.splice(0);

    for (const [index, notification] of notifications.entries()) {
      if (entry.refreshOperation?.token !== refreshToken) {
        carryRefreshIndependentNotifications(entry, notifications.slice(index));
        return;
      }

      dispatchListenerNotification(entry, notification);
    }
  }

  if (entry.refreshOperation?.token === refreshToken) {
    entry.bufferingNotifications = false;
  }
}

function carryRefreshIndependentNotifications(
  entry: CloudDeviceListenerEntry,
  notifications: readonly CloudDeviceNotification[],
): void {
  if (entry.refreshOperation === undefined || !entry.bufferingNotifications) {
    return;
  }

  entry.pendingNotifications.unshift(
    ...notifications.filter(notification =>
      isRefreshIndependentNotification(entry, notification),
    ),
  );
}

function retainRefreshIndependentNotifications(
  entry: CloudDeviceListenerEntry,
): void {
  const notifications = entry.pendingNotifications.filter(notification =>
    isRefreshIndependentNotification(entry, notification),
  );

  entry.pendingNotifications.splice(
    0,
    entry.pendingNotifications.length,
    ...notifications,
  );
}

function retainPostSnapshotNotifications(
  entry: CloudDeviceListenerEntry,
  replayedSnapshotUpdateMap: ReadonlyMap<string, CloudPropertyUpdate>,
  propertyBaselineMap: ReadonlyMap<string, number>,
  unavailableSnapshotPropertyKeySet: ReadonlySet<string>,
): void {
  const notifications = entry.pendingNotifications.filter(notification => {
    if (notification.type === 'event') {
      return true;
    }

    const key = getPropertyKey(notification.data);

    return (
      !entry.snapshotPropertyMap.has(key) ||
      (entry.replaySnapshotPropertyNotificationKeySet.has(key) &&
        (unavailableSnapshotPropertyKeySet.has(key) ||
          (replayedSnapshotUpdateMap.has(key) &&
            notification.data.revision > (propertyBaselineMap.get(key) ?? 0))))
    );
  });

  entry.pendingNotifications.splice(
    0,
    entry.pendingNotifications.length,
    ...notifications,
  );
}

function hasPendingSnapshotPropertyNotification(
  entry: CloudDeviceListenerEntry,
  key: string,
  baselineRevision: number,
): boolean {
  return entry.pendingNotifications.some(notification => {
    return (
      notification.type === 'property-change' &&
      getPropertyKey(notification.data) === key &&
      notification.data.revision > baselineRevision
    );
  });
}

function invalidateDeliveredEntrySnapshot(
  entry: CloudDeviceListenerEntry,
): void {
  const properties = [...entry.snapshotPropertyMap].flatMap(
    ([key, property]) => {
      return entry.deliveredSnapshotPropertyKeySet.has(key) ? [property] : [];
    },
  );

  if (properties.length === 0) {
    return;
  }

  entry.deliveredSnapshotPropertyKeySet.clear();
  callListenerCallback(
    entry.listener,
    entry.listener.onSnapshotInvalidated,
    properties,
  );
}

function hasPendingSnapshotRefreshEvent(
  entry: CloudDeviceListenerEntry,
): boolean {
  return entry.pendingNotifications.some(notification => {
    return (
      notification.type === 'event' &&
      entry.refreshSnapshotOnEventKeySet.has(getEventKey(notification.data))
    );
  });
}

function isRefreshIndependentNotification(
  entry: CloudDeviceListenerEntry,
  notification: CloudDeviceNotification,
): boolean {
  return (
    notification.type === 'event' ||
    !entry.snapshotPropertyMap.has(getPropertyKey(notification.data)) ||
    entry.replaySnapshotPropertyNotificationKeySet.has(
      getPropertyKey(notification.data),
    )
  );
}

function discardEntryNotifications(
  entry: CloudDeviceListenerEntry,
  refreshToken: object,
): void {
  if (entry.refreshOperation?.token !== refreshToken) {
    return;
  }

  entry.pendingNotifications.length = 0;
  entry.bufferingNotifications = false;
}

function dispatchListenerNotification(
  entry: CloudDeviceListenerEntry,
  notification: CloudDeviceNotification,
): void {
  const {listener} = entry;
  callListenerCallback(listener, listener.onNotification, notification);

  if (notification.type === 'property-change') {
    callListenerCallback(
      listener,
      listener.onPropertyChanged,
      notification.data,
    );
  } else {
    callListenerCallback(listener, listener.onEventOccurred, notification.data);
  }

  if (
    notification.type === 'property-change' &&
    entry.snapshotPropertyMap.has(getPropertyKey(notification.data))
  ) {
    entry.deliveredSnapshotPropertyKeySet.add(
      getPropertyKey(notification.data),
    );
  }
}

function publishListenerState(
  entry: CloudDeviceListenerEntry,
  state: CloudDeviceState,
): void {
  entry.listener.onStateChanged?.(state);
  entry.initialized = true;

  if (state.online) {
    entry.deliveredSnapshotPropertyKeySet.clear();

    for (const property of state.properties) {
      const key = getPropertyKey(property);

      if (entry.snapshotPropertyMap.has(key)) {
        entry.deliveredSnapshotPropertyKeySet.add(key);
      }
    }
  }
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
