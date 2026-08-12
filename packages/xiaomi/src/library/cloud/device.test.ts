import {CLOUD_MQTT_RECONNECT_INTERVAL} from './constants.js';
import {
  CloudDeviceChannel,
  type CloudDeviceMessageSource,
  type CloudDeviceState,
  type CloudPropertySnapshot,
  type CloudPropertyUpdate,
} from './device.js';
import type {CloudMqttDeviceMessageHandler} from './mqtt.js';

const DID = 'device-1';
const FIRST_PROPERTY = {did: DID, siid: 2, piid: 1};
const SECOND_PROPERTY = {did: DID, siid: 2, piid: 2};

test('publishes one initial state and keeps MQTT updates newer than the snapshot', async () => {
  const snapshot = deferred<readonly CloudPropertySnapshot[]>();
  const online = deferred<boolean>();
  const source = createMessageSource();
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;
      return snapshot.promise;
    },
    async () => online.promise,
    () => undefined,
  );
  const states: CloudDeviceState[] = [];
  const updates: CloudPropertyUpdate[] = [];
  const subscriptionPromise = channel.subscribe(
    [FIRST_PROPERTY, SECOND_PROPERTY],
    {
      onStateChanged: state => {
        states.push(state);
      },
      onPropertyChanged: update => {
        updates.push(update);
      },
    },
  );

  await waitFor(() => readCount === 1);
  source.send({...FIRST_PROPERTY, type: 'property', value: true});

  expect(states).toEqual([]);
  expect(updates).toEqual([]);

  snapshot.resolve([
    {...SECOND_PROPERTY, value: 40, code: 0},
    {...FIRST_PROPERTY, value: false, code: 0},
  ]);
  online.resolve(true);

  const subscription = await subscriptionPromise;

  expect(states).toEqual([
    {
      did: DID,
      online: true,
      properties: [
        {
          ...FIRST_PROPERTY,
          value: true,
          revision: 1,
          source: 'mqtt',
        },
        {
          ...SECOND_PROPERTY,
          value: 40,
          revision: 2,
          source: 'snapshot',
        },
      ],
    },
  ]);

  source.send({...SECOND_PROPERTY, type: 'property', value: 50});

  expect(updates).toEqual([
    {
      ...SECOND_PROPERTY,
      value: 50,
      revision: 3,
      source: 'mqtt',
    },
  ]);

  await subscription.dispose();
});

test('rejects an incomplete initial state, removes the observer, and can retry', async () => {
  const source = createMessageSource();
  let results: readonly CloudPropertySnapshot[] = [
    {...FIRST_PROPERTY, value: false, code: 0},
    {...SECOND_PROPERTY, code: -1},
  ];
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => results,
    async () => true,
    () => undefined,
  );
  const states: CloudDeviceState[] = [];
  const updates: CloudPropertyUpdate[] = [];
  const errors: unknown[] = [];
  const observer = {
    onStateChanged: (state: CloudDeviceState) => {
      states.push(state);
    },
    onPropertyChanged: (update: CloudPropertyUpdate) => {
      updates.push(update);
    },
    onError: (error: unknown) => {
      errors.push(error);
    },
  };

  await expect(
    channel.subscribe([FIRST_PROPERTY, SECOND_PROPERTY], observer),
  ).rejects.toThrow('Cloud snapshot property 2.2 failed: -1.');

  expect(states).toEqual([]);
  expect(errors).toEqual([]);
  expect(source.unsubscribeCount).toBe(1);

  source.send({...FIRST_PROPERTY, type: 'property', value: true});
  expect(updates).toEqual([]);

  results = [
    {...FIRST_PROPERTY, value: true, code: 0},
    {...SECOND_PROPERTY, value: 75, code: 0},
  ];
  const subscription = await channel.subscribe(
    [FIRST_PROPERTY, SECOND_PROPERTY],
    observer,
  );

  expect(source.subscribeCount).toBe(2);
  expect(states).toHaveLength(1);
  expect(states[0]).toMatchObject({
    did: DID,
    online: true,
    properties: [
      {...FIRST_PROPERTY, value: true, source: 'snapshot'},
      {...SECOND_PROPERTY, value: 75, source: 'snapshot'},
    ],
  });

  await subscription.dispose();
});

test('does not mark an observer initialized when its first state callback throws', async () => {
  const source = createMessageSource();
  const callbackError = new Error('State callback failed.');
  const states: CloudDeviceState[] = [];
  let callbackCount = 0;
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;
      return [{...FIRST_PROPERTY, value: true, code: 0}];
    },
    async () => true,
    () => undefined,
  );
  const observer = {
    onStateChanged: (state: CloudDeviceState) => {
      callbackCount++;

      if (callbackCount === 1) {
        throw callbackError;
      }

      states.push(state);
    },
  };

  await expect(channel.subscribe([FIRST_PROPERTY], observer)).rejects.toBe(
    callbackError,
  );

  expect(source.unsubscribeCount).toBe(1);
  expect(states).toEqual([]);

  const subscription = await channel.subscribe([FIRST_PROPERTY], observer);

  expect(readCount).toBe(2);
  expect(states).toHaveLength(1);
  await subscription.dispose();
});

test.each([
  {
    result: 'fails',
    readProperties: async () => {
      throw new Error('Snapshot failed.');
    },
  },
  {
    result: 'omits properties',
    readProperties: async () => [],
  },
])(
  'publishes offline when the property read $result',
  async ({readProperties}) => {
    const source = createMessageSource();
    const states: CloudDeviceState[] = [];
    const channel = new CloudDeviceChannel(
      DID,
      source,
      readProperties,
      async () => false,
      () => undefined,
    );
    const subscription = await channel.subscribe([FIRST_PROPERTY], {
      onStateChanged: state => {
        states.push(state);
      },
    });

    expect(states).toEqual([{did: DID, online: false, properties: []}]);
    await subscription.dispose();
  },
);

test('does not let an older overlapping refresh overwrite newer state', async () => {
  const source = createMessageSource();
  const propertyReads: Array<Deferred<readonly CloudPropertySnapshot[]>> = [];
  const onlineReads: Array<Deferred<boolean>> = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount === 1) {
        return [{...FIRST_PROPERTY, value: 0, code: 0}];
      }

      const read = deferred<readonly CloudPropertySnapshot[]>();
      propertyReads.push(read);
      return read.promise;
    },
    async () => {
      if (readCount === 1) {
        return true;
      }

      const read = deferred<boolean>();
      onlineReads.push(read);
      return read.promise;
    },
    () => undefined,
  );
  const states: CloudDeviceState[] = [];
  const subscription = await channel.subscribe([FIRST_PROPERTY], {
    onStateChanged: state => {
      states.push(state);
    },
  });
  const olderRefresh = subscription.refresh();

  await waitFor(() => propertyReads.length === 1 && onlineReads.length === 1);

  const newerRefresh = subscription.refresh();

  await waitFor(() => propertyReads.length === 2 && onlineReads.length === 2);
  propertyReads[1]?.resolve([{...FIRST_PROPERTY, value: 2, code: 0}]);
  onlineReads[1]?.resolve(true);
  await newerRefresh;

  propertyReads[0]?.resolve([{...FIRST_PROPERTY, value: 1, code: 0}]);
  onlineReads[0]?.resolve(false);
  await olderRefresh;
  await Promise.resolve();

  expect(states).toHaveLength(2);
  expect(states.at(-1)).toMatchObject({
    online: true,
    properties: [{...FIRST_PROPERTY, value: 2, source: 'snapshot'}],
  });

  await subscription.dispose();
});

test('allows MQTT to supply a property omitted by the in-flight snapshot', async () => {
  const snapshot = deferred<readonly CloudPropertySnapshot[]>();
  const source = createMessageSource();
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;
      return snapshot.promise;
    },
    async () => true,
    () => undefined,
  );
  const states: CloudDeviceState[] = [];
  const subscriptionPromise = channel.subscribe(
    [FIRST_PROPERTY, SECOND_PROPERTY],
    {
      onStateChanged: state => {
        states.push(state);
      },
    },
  );

  await waitFor(() => readCount === 1);
  source.send({...SECOND_PROPERTY, type: 'property', value: 70});
  snapshot.resolve([{...FIRST_PROPERTY, value: true, code: 0}]);

  const subscription = await subscriptionPromise;
  expect(states).toHaveLength(1);
  expect(states[0]).toMatchObject({
    online: true,
    properties: [
      {...FIRST_PROPERTY, value: true, source: 'snapshot'},
      {...SECOND_PROPERTY, value: 70, source: 'mqtt'},
    ],
  });

  await subscription.dispose();
});

test('rejects and removes the observer when initial state loading fails', async () => {
  const source = createMessageSource();
  const snapshotError = new Error('Snapshot failed.');
  const errors: unknown[] = [];
  const states: CloudDeviceState[] = [];
  let emptyCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      throw snapshotError;
    },
    async () => true,
    () => {
      emptyCount++;
    },
  );
  await expect(
    channel.subscribe([FIRST_PROPERTY], {
      onStateChanged: state => {
        states.push(state);
      },
      onError: error => {
        errors.push(error);
      },
    }),
  ).rejects.toBe(snapshotError);

  expect(errors).toEqual([]);
  expect(states).toEqual([]);
  expect(source.unsubscribeCount).toBe(1);
  expect(emptyCount).toBe(1);
});

test('publishes offline immediately and refreshes fully before online', async () => {
  const onlineSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const source = createMessageSource();
  let readCount = 0;
  let onlineReadCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount === 1) {
        return [{...FIRST_PROPERTY, value: false, code: 0}];
      }

      return onlineSnapshot.promise;
    },
    async () => {
      onlineReadCount++;
      return true;
    },
    () => undefined,
  );
  const states: CloudDeviceState[] = [];
  const updates: CloudPropertyUpdate[] = [];
  const subscription = await channel.subscribe([FIRST_PROPERTY], {
    onStateChanged: state => {
      states.push(state);
    },
    onPropertyChanged: update => {
      updates.push(update);
    },
  });

  source.send({type: 'state', did: DID, online: false});

  expect(states.at(-1)).toEqual({did: DID, online: false, properties: []});

  source.send({type: 'state', did: DID, online: true});
  await waitFor(() => readCount === 2);

  expect(states).toHaveLength(2);
  expect(onlineReadCount).toBe(1);

  source.send({...FIRST_PROPERTY, type: 'property', value: true});
  expect(updates.at(-1)).toMatchObject({
    ...FIRST_PROPERTY,
    value: true,
    source: 'mqtt',
  });

  onlineSnapshot.resolve([{...FIRST_PROPERTY, value: false, code: 0}]);
  await waitFor(() => states.length === 3);

  expect(states.at(-1)).toMatchObject({
    did: DID,
    online: true,
    properties: [{...FIRST_PROPERTY, value: true, source: 'mqtt'}],
  });

  await subscription.dispose();
});

test('an offline event during initialization invalidates the stale snapshot', async () => {
  const snapshot = deferred<readonly CloudPropertySnapshot[]>();
  const online = deferred<boolean>();
  const source = createMessageSource();
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;
      return snapshot.promise;
    },
    async () => online.promise,
    () => undefined,
  );
  const states: CloudDeviceState[] = [];
  const subscriptionPromise = channel.subscribe([FIRST_PROPERTY], {
    onStateChanged: state => {
      states.push(state);
    },
  });

  await waitFor(() => readCount === 1);
  source.send({type: 'state', did: DID, online: false});

  expect(states).toEqual([{did: DID, online: false, properties: []}]);

  snapshot.resolve([{...FIRST_PROPERTY, value: true, code: 0}]);
  online.resolve(true);

  const subscription = await subscriptionPromise;
  expect(states).toEqual([{did: DID, online: false, properties: []}]);

  await subscription.dispose();
});

test('broker reconnect invalidates in-flight state without publishing offline', async () => {
  const source = createMessageSource();
  const propertyReads: Array<Deferred<readonly CloudPropertySnapshot[]>> = [];
  const onlineReads: Array<Deferred<boolean>> = [];
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      const read = deferred<readonly CloudPropertySnapshot[]>();
      propertyReads.push(read);
      return read.promise;
    },
    async () => {
      const read = deferred<boolean>();
      onlineReads.push(read);
      return read.promise;
    },
    () => undefined,
  );
  const states: CloudDeviceState[] = [];
  const subscriptionPromise = channel.subscribe([FIRST_PROPERTY], {
    onStateChanged: state => {
      states.push(state);
    },
  });

  await waitFor(() => propertyReads.length === 1 && onlineReads.length === 1);
  propertyReads[0]?.resolve([{...FIRST_PROPERTY, value: false, code: 0}]);
  onlineReads[0]?.resolve(true);
  const subscription = await subscriptionPromise;

  let staleRefreshResolved = false;
  const staleRefresh = subscription.refresh().then(() => {
    staleRefreshResolved = true;
  });
  await waitFor(() => propertyReads.length === 2 && onlineReads.length === 2);

  channel.handleConnectionState(false);
  expect(states).toHaveLength(1);

  channel.handleConnectionState(true);
  await waitFor(() => propertyReads.length === 3 && onlineReads.length === 3);

  propertyReads[1]?.resolve([{...FIRST_PROPERTY, value: true, code: 0}]);
  onlineReads[1]?.resolve(false);
  await Promise.resolve();
  expect(staleRefreshResolved).toBe(false);
  expect(states).toHaveLength(1);

  propertyReads[2]?.resolve([{...FIRST_PROPERTY, value: true, code: 0}]);
  onlineReads[2]?.resolve(true);
  await staleRefresh;
  await waitFor(() => states.length === 2);

  expect(states.at(-1)).toMatchObject({
    did: DID,
    online: true,
    properties: [{...FIRST_PROPERTY, value: true, source: 'snapshot'}],
  });

  await subscription.dispose();
});

test('retries one reconnect refresh at a time until it succeeds', async () => {
  import.meta.jest.useFakeTimers();

  const source = createMessageSource();
  const refreshError = new Error('Reconnect snapshot failed.');
  const states: CloudDeviceState[] = [];
  const errors: unknown[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount === 2) {
        throw refreshError;
      }

      return [{...FIRST_PROPERTY, value: readCount, code: 0}];
    },
    async () => true,
    () => undefined,
  );

  try {
    const subscription = await channel.subscribe([FIRST_PROPERTY], {
      onStateChanged: state => {
        states.push(state);
      },
      onError: error => {
        errors.push(error);
      },
    });

    channel.handleConnectionState(false);
    channel.handleConnectionState(true);
    channel.handleConnectionState(true);
    await waitFor(() => errors.length === 1);

    expect(readCount).toBe(2);
    expect(errors).toEqual([refreshError]);
    expect(import.meta.jest.getTimerCount()).toBe(1);

    await import.meta.jest.advanceTimersByTimeAsync(
      CLOUD_MQTT_RECONNECT_INTERVAL,
    );
    await waitFor(() => states.length === 2);

    expect(readCount).toBe(3);
    expect(states.at(-1)).toMatchObject({
      online: true,
      properties: [{...FIRST_PROPERTY, value: 3, source: 'snapshot'}],
    });
    expect(import.meta.jest.getTimerCount()).toBe(0);

    await subscription.dispose();
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test.each(['disconnect', 'empty'] as const)(
  'stops reconnect refresh retry when the channel becomes $result',
  async result => {
    import.meta.jest.useFakeTimers();

    const source = createMessageSource();
    let readCount = 0;
    const channel = new CloudDeviceChannel(
      DID,
      source,
      async () => {
        readCount++;

        if (readCount > 1) {
          throw new Error('Reconnect snapshot failed.');
        }

        return [{...FIRST_PROPERTY, value: true, code: 0}];
      },
      async () => true,
      () => undefined,
    );

    try {
      const subscription = await channel.subscribe([FIRST_PROPERTY], {
        onError: () => undefined,
      });

      channel.handleConnectionState(false);
      channel.handleConnectionState(true);
      await waitFor(() => import.meta.jest.getTimerCount() === 1);

      if (result === 'disconnect') {
        channel.handleConnectionState(false);
      } else {
        await subscription.dispose();
      }

      expect(import.meta.jest.getTimerCount()).toBe(0);
      await import.meta.jest.advanceTimersByTimeAsync(
        CLOUD_MQTT_RECONNECT_INTERVAL,
      );
      expect(readCount).toBe(2);

      await subscription.dispose();
    } finally {
      import.meta.jest.useRealTimers();
    }
  },
);

test('does not leave subscribe waiting on a snapshot invalidated by reconnect', async () => {
  const source = createMessageSource();
  const firstProperties = deferred<readonly CloudPropertySnapshot[]>();
  const firstOnline = deferred<boolean>();
  let propertyReadCount = 0;
  let onlineReadCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      propertyReadCount++;

      if (propertyReadCount === 1) {
        return firstProperties.promise;
      }

      return [{...FIRST_PROPERTY, value: true, code: 0}];
    },
    async () => {
      onlineReadCount++;
      return onlineReadCount === 1 ? firstOnline.promise : true;
    },
    () => undefined,
  );
  const states: CloudDeviceState[] = [];
  let subscribeResolved = false;
  const subscriptionPromise = channel
    .subscribe([FIRST_PROPERTY], {
      onStateChanged: state => {
        states.push(state);
      },
    })
    .then(subscription => {
      subscribeResolved = true;
      return subscription;
    });

  await waitFor(() => propertyReadCount === 1 && onlineReadCount === 1);
  channel.handleConnectionState(false);
  channel.handleConnectionState(true);
  await waitFor(() => propertyReadCount === 2 && onlineReadCount === 2);
  await waitFor(() => subscribeResolved);

  expect(states).toHaveLength(1);
  expect(states[0]).toMatchObject({
    did: DID,
    online: true,
    properties: [{...FIRST_PROPERTY, value: true, source: 'snapshot'}],
  });

  firstProperties.resolve([{...FIRST_PROPERTY, value: false, code: 0}]);
  firstOnline.resolve(false);
  await Promise.resolve();
  expect(states).toHaveLength(1);

  await (await subscriptionPromise).dispose();
});

test('keeps state and updates scoped to each observer', async () => {
  const source = createMessageSource();
  const reads: Array<readonly string[]> = [];
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async properties => {
      reads.push(
        properties.map(property => `${property.siid}.${property.piid}`),
      );
      return properties.map(property => ({
        ...property,
        value: property.piid * 10,
        code: 0,
      }));
    },
    async () => true,
    () => undefined,
  );
  const firstStates: CloudDeviceState[] = [];
  const secondStates: CloudDeviceState[] = [];
  const firstUpdates: CloudPropertyUpdate[] = [];
  const secondUpdates: CloudPropertyUpdate[] = [];
  const firstSubscription = await channel.subscribe([FIRST_PROPERTY], {
    onStateChanged: state => {
      firstStates.push(state);
    },
    onPropertyChanged: update => {
      firstUpdates.push(update);
    },
  });
  const secondSubscription = await channel.subscribe([SECOND_PROPERTY], {
    onStateChanged: state => {
      secondStates.push(state);
    },
    onPropertyChanged: update => {
      secondUpdates.push(update);
    },
  });

  expect(source.subscribeCount).toBe(1);
  expect(firstStates[0]?.properties).toHaveLength(1);
  expect(firstStates[0]?.properties[0]).toMatchObject(FIRST_PROPERTY);
  expect(secondStates[0]?.properties).toHaveLength(1);
  expect(secondStates[0]?.properties[0]).toMatchObject(SECOND_PROPERTY);

  source.send({...FIRST_PROPERTY, type: 'property', value: 99});
  expect(firstUpdates).toHaveLength(1);
  expect(secondUpdates).toEqual([]);

  channel.handleConnectionState(false);
  channel.handleConnectionState(true);
  await waitFor(() => firstStates.length === 2 && secondStates.length === 2);

  expect(reads.at(-1)).toEqual(['2.1', '2.2']);
  expect(firstStates.at(-1)?.properties).toHaveLength(1);
  expect(firstStates.at(-1)?.properties[0]).toMatchObject(FIRST_PROPERTY);
  expect(secondStates.at(-1)?.properties).toHaveLength(1);
  expect(secondStates.at(-1)?.properties[0]).toMatchObject(SECOND_PROPERTY);

  await firstSubscription.dispose();
  expect(source.unsubscribeCount).toBe(0);
  await secondSubscription.dispose();
  expect(source.unsubscribeCount).toBe(1);
});

function createMessageSource(): TestMessageSource {
  let handler: CloudMqttDeviceMessageHandler | undefined;

  return {
    subscribeCount: 0,
    unsubscribeCount: 0,
    async subscribeDevice(_did, nextHandler) {
      this.subscribeCount++;
      handler = nextHandler;
    },
    async unsubscribeDevice(_did) {
      this.unsubscribeCount++;
    },
    send(message) {
      if (handler === undefined) {
        throw new Error('Cloud MQTT handler was not registered.');
      }

      handler(message);
    },
  };
}

type TestMessageSource = CloudDeviceMessageSource & {
  subscribeCount: number;
  unsubscribeCount: number;
  send(message: Parameters<CloudMqttDeviceMessageHandler>[0]): void;
};

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: value => {
      if (resolvePromise === undefined) {
        throw new Error('Deferred promise is missing its resolver.');
      }

      resolvePromise(value);
    },
  };
}

type Deferred<T> = {
  readonly promise: Promise<T>;
  resolve(value: T): void;
};

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (condition()) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error('Expected condition was not reached.');
}
