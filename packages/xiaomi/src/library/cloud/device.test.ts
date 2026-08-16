import {CLOUD_MQTT_RECONNECT_INTERVAL} from './constants.js';
import {
  CloudDeviceChannel,
  type CloudDeviceMessageSource,
  type CloudDeviceNotification,
  type CloudDeviceState,
  type CloudPropertySnapshot,
  type CloudPropertyUpdate,
} from './device.js';
import type {CloudMqttDeviceMessageHandler} from './mqtt.js';

const DID = 'device-1';
const FIRST_PROPERTY = {did: DID, siid: 2, piid: 1};
const SECOND_PROPERTY = {did: DID, siid: 2, piid: 2};
const THIRD_PROPERTY = {did: DID, siid: 2, piid: 3};
const FIRST_PROPERTY_CHANGE = {
  type: 'property-change',
  data: FIRST_PROPERTY,
} as const;
const SECOND_PROPERTY_CHANGE = {
  type: 'property-change',
  data: SECOND_PROPERTY,
} as const;
const THIRD_PROPERTY_CHANGE = {
  type: 'property-change',
  data: THIRD_PROPERTY,
} as const;
const FIRST_EVENT = {
  type: 'event',
  data: {did: DID, siid: 2, eiid: 1},
} as const;

test('publishes one initial state and absorbs newer snapshot property changes', async () => {
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
    {
      snapshotProperties: [FIRST_PROPERTY, SECOND_PROPERTY],
      notifications: [FIRST_PROPERTY_CHANGE, SECOND_PROPERTY_CHANGE],
    },
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
  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: true},
  });

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
  expect(updates).toEqual([]);

  source.send({
    type: 'property-change',
    data: {...SECOND_PROPERTY, value: 50},
  });

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

test('rejects an incomplete initial state, removes the listener, and can retry', async () => {
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
  const listener = {
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
    channel.subscribe(
      {snapshotProperties: [FIRST_PROPERTY, SECOND_PROPERTY]},
      listener,
    ),
  ).rejects.toThrow('Cloud snapshot property 2.2 failed: -1.');

  expect(states).toEqual([]);
  expect(errors).toEqual([]);
  expect(source.unsubscribeCount).toBe(1);

  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: true},
  });
  expect(updates).toEqual([]);

  results = [
    {...FIRST_PROPERTY, value: true, code: 0},
    {...SECOND_PROPERTY, value: 75, code: 0},
  ];
  const subscription = await channel.subscribe(
    {snapshotProperties: [FIRST_PROPERTY, SECOND_PROPERTY]},
    listener,
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

test('does not mark a listener initialized when its first state callback throws', async () => {
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
  const listener = {
    onStateChanged: (state: CloudDeviceState) => {
      callbackCount++;

      if (callbackCount === 1) {
        throw callbackError;
      }

      states.push(state);
    },
  };

  await expect(
    channel.subscribe({snapshotProperties: [FIRST_PROPERTY]}, listener),
  ).rejects.toBe(callbackError);

  expect(source.unsubscribeCount).toBe(1);
  expect(states).toEqual([]);

  const subscription = await channel.subscribe(
    {snapshotProperties: [FIRST_PROPERTY]},
    listener,
  );

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
    const subscription = await channel.subscribe(
      {snapshotProperties: [FIRST_PROPERTY]},
      {
        onStateChanged: state => {
          states.push(state);
        },
      },
    );

    expect(states).toEqual([{did: DID, online: false, properties: []}]);
    await subscription.dispose();
  },
);

test('drops buffered notifications when a refresh publishes offline', async () => {
  const propertyRead = deferred<readonly CloudPropertySnapshot[]>();
  const onlineRead = deferred<boolean>();
  const source = createMessageSource();
  const notifications: CloudDeviceNotification[] = [];
  const states: CloudDeviceState[] = [];
  let readCount = 0;
  let onlineReadCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount === 2) {
        return propertyRead.promise;
      }

      return [{...FIRST_PROPERTY, value: false, code: 0}];
    },
    async () => {
      onlineReadCount++;
      return onlineReadCount === 2 ? onlineRead.promise : true;
    },
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [FIRST_PROPERTY_CHANGE, FIRST_EVENT],
    },
    {
      onStateChanged: state => {
        states.push(state);
      },
      onNotification: notification => {
        notifications.push(notification);
      },
    },
  );
  const refresh = subscription.refresh();

  await waitFor(() => readCount === 2 && onlineReadCount === 2);
  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: true},
  });
  source.send({
    type: 'event',
    data: {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {type: 'identified', data: []},
    },
  });

  expect(notifications).toEqual([]);

  propertyRead.resolve([{...FIRST_PROPERTY, value: true, code: 0}]);
  onlineRead.resolve(false);
  await refresh;

  expect(states.at(-1)).toEqual({did: DID, online: false, properties: []});
  expect(notifications).toEqual([]);

  await subscription.refresh();

  expect(states.at(-1)).toMatchObject({
    did: DID,
    online: true,
    properties: [{...FIRST_PROPERTY, value: false, source: 'snapshot'}],
  });
  expect(notifications).toEqual([]);

  await subscription.dispose();
});

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
  const subscription = await channel.subscribe(
    {snapshotProperties: [FIRST_PROPERTY]},
    {
      onStateChanged: state => {
        states.push(state);
      },
    },
  );
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
    {
      snapshotProperties: [FIRST_PROPERTY, SECOND_PROPERTY],
      notifications: [SECOND_PROPERTY_CHANGE],
    },
    {
      onStateChanged: state => {
        states.push(state);
      },
    },
  );

  await waitFor(() => readCount === 1);
  source.send({
    type: 'property-change',
    data: {...SECOND_PROPERTY, value: 70},
  });
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

test('rejects and removes the listener when initial state loading fails', async () => {
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
    channel.subscribe(
      {snapshotProperties: [FIRST_PROPERTY]},
      {
        onStateChanged: state => {
          states.push(state);
        },
        onError: error => {
          errors.push(error);
        },
      },
    ),
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
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [FIRST_PROPERTY_CHANGE],
    },
    {
      onStateChanged: state => {
        states.push(state);
      },
      onPropertyChanged: update => {
        updates.push(update);
      },
    },
  );

  source.send({type: 'state', data: {did: DID, online: false}});

  expect(states.at(-1)).toEqual({did: DID, online: false, properties: []});

  source.send({type: 'state', data: {did: DID, online: true}});
  await waitFor(() => readCount === 2);

  expect(states).toHaveLength(2);
  expect(onlineReadCount).toBe(1);

  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: true},
  });
  expect(updates).toEqual([]);

  onlineSnapshot.resolve([{...FIRST_PROPERTY, value: false, code: 0}]);
  await waitFor(() => states.length === 3);

  expect(states.at(-1)).toMatchObject({
    did: DID,
    online: true,
    properties: [{...FIRST_PROPERTY, value: true, source: 'mqtt'}],
  });
  expect(updates).toEqual([]);

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
  const subscriptionPromise = channel.subscribe(
    {snapshotProperties: [FIRST_PROPERTY]},
    {
      onStateChanged: state => {
        states.push(state);
      },
    },
  );

  await waitFor(() => readCount === 1);
  source.send({type: 'state', data: {did: DID, online: false}});

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
  const notifications: CloudDeviceNotification[] = [];
  const subscriptionPromise = channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [SECOND_PROPERTY_CHANGE, FIRST_EVENT],
    },
    {
      onStateChanged: state => {
        states.push(state);
      },
      onNotification: notification => {
        notifications.push(notification);
      },
    },
  );

  await waitFor(() => propertyReads.length === 1 && onlineReads.length === 1);
  propertyReads[0]?.resolve([{...FIRST_PROPERTY, value: false, code: 0}]);
  onlineReads[0]?.resolve(true);
  const subscription = await subscriptionPromise;

  let staleRefreshResolved = false;
  const staleRefresh = subscription.refresh().then(() => {
    staleRefreshResolved = true;
  });
  await waitFor(() => propertyReads.length === 2 && onlineReads.length === 2);
  source.send({
    type: 'property-change',
    data: {...SECOND_PROPERTY, value: 42},
  });
  source.send({
    type: 'event',
    data: {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {type: 'identified', data: []},
    },
  });

  channel.handleConnectionState(false);
  expect(states).toHaveLength(1);
  expect(notifications).toEqual([]);

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
  expect(notifications).toEqual([]);

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
    const subscription = await channel.subscribe(
      {snapshotProperties: [FIRST_PROPERTY]},
      {
        onStateChanged: state => {
          states.push(state);
        },
        onError: error => {
          errors.push(error);
        },
      },
    );

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

test('retries reconnect refresh when an initialized listener rejects the full state', async () => {
  import.meta.jest.useFakeTimers();

  const source = createMessageSource();
  const callbackError = new Error('State callback failed.');
  const states: CloudDeviceState[] = [];
  const errors: unknown[] = [];
  let readCount = 0;
  let callbackCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;
      return [{...FIRST_PROPERTY, value: readCount, code: 0}];
    },
    async () => true,
    () => undefined,
  );

  try {
    const subscription = await channel.subscribe(
      {snapshotProperties: [FIRST_PROPERTY]},
      {
        onStateChanged: state => {
          callbackCount++;

          if (callbackCount === 2) {
            throw callbackError;
          }

          states.push(state);
        },
        onError: error => {
          errors.push(error);
        },
      },
    );

    channel.handleConnectionState(false);
    channel.handleConnectionState(true);
    await waitFor(() => errors.length === 1);

    expect(readCount).toBe(2);
    expect(callbackCount).toBe(2);
    expect(states).toHaveLength(1);
    expect(errors).toEqual([callbackError]);
    expect(import.meta.jest.getTimerCount()).toBe(1);

    await import.meta.jest.advanceTimersByTimeAsync(
      CLOUD_MQTT_RECONNECT_INTERVAL,
    );
    await waitFor(() => states.length === 2);

    expect(readCount).toBe(3);
    expect(callbackCount).toBe(3);
    expect(states.at(-1)).toMatchObject({
      online: true,
      properties: [{...FIRST_PROPERTY, value: 3, source: 'snapshot'}],
    });
    expect(import.meta.jest.getTimerCount()).toBe(0);

    channel.handleConnectionState(true);
    await Promise.resolve();
    expect(readCount).toBe(3);

    await subscription.dispose();
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test.each([true, false])(
  'retries a failed MQTT online=%s state refresh with the same override',
  async online => {
    import.meta.jest.useFakeTimers();

    const source = createMessageSource();
    const callbackError = new Error('State callback failed.');
    const states: CloudDeviceState[] = [];
    const errors: unknown[] = [];
    let propertyReadCount = 0;
    let onlineReadCount = 0;
    let callbackCount = 0;
    const channel = new CloudDeviceChannel(
      DID,
      source,
      async () => {
        propertyReadCount++;
        return [{...FIRST_PROPERTY, value: propertyReadCount, code: 0}];
      },
      async () => {
        onlineReadCount++;
        return true;
      },
      () => undefined,
    );

    try {
      const subscription = await channel.subscribe(
        {snapshotProperties: [FIRST_PROPERTY]},
        {
          onStateChanged: state => {
            callbackCount++;

            if (callbackCount === 2) {
              throw callbackError;
            }

            states.push(state);
          },
          onError: error => {
            errors.push(error);
          },
        },
      );

      source.send({type: 'state', data: {did: DID, online}});
      await waitFor(() => errors.length === 1);

      expect(propertyReadCount).toBe(online ? 2 : 1);
      expect(onlineReadCount).toBe(1);
      expect(errors).toEqual([callbackError]);
      expect(import.meta.jest.getTimerCount()).toBe(1);

      await import.meta.jest.advanceTimersByTimeAsync(
        CLOUD_MQTT_RECONNECT_INTERVAL,
      );
      await waitFor(() => states.length === 2);

      expect(callbackCount).toBe(3);
      expect(propertyReadCount).toBe(online ? 3 : 1);
      expect(onlineReadCount).toBe(1);
      expect(states.at(-1)).toMatchObject(
        online
          ? {
              did: DID,
              online: true,
              properties: [{...FIRST_PROPERTY, value: 3, source: 'snapshot'}],
            }
          : {did: DID, online: false, properties: []},
      );
      expect(import.meta.jest.getTimerCount()).toBe(0);

      await subscription.dispose();
    } finally {
      import.meta.jest.useRealTimers();
    }
  },
);

test('reports incremental listener errors without interrupting other listeners', async () => {
  const source = createMessageSource();
  const propertyError = new Error('Property callback failed.');
  const eventError = new Error('Event callback failed.');
  const errors: unknown[] = [];
  const updates: CloudPropertyUpdate[] = [];
  const events: unknown[] = [];
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async properties =>
      properties.map(property => ({...property, value: 0, code: 0})),
    async () => true,
    () => undefined,
  );
  const firstSubscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [FIRST_PROPERTY_CHANGE, FIRST_EVENT],
    },
    {
      onPropertyChanged: () => {
        throw propertyError;
      },
      onEventOccurred: () => {
        throw eventError;
      },
      onError: error => {
        errors.push(error);
      },
    },
  );
  const secondSubscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [FIRST_PROPERTY_CHANGE, FIRST_EVENT],
    },
    {
      onPropertyChanged: update => {
        updates.push(update);
      },
      onEventOccurred: event => {
        events.push(event);
      },
    },
  );

  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: 1},
  });
  source.send({
    type: 'event',
    data: {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {type: 'identified', data: []},
    },
  });

  expect(errors).toEqual([propertyError, eventError]);
  expect(updates).toHaveLength(1);
  expect(events).toHaveLength(1);

  await firstSubscription.dispose();
  await secondSubscription.dispose();
});

test('notifies the empty owner while preserving an unsubscribe failure', async () => {
  const source = createMessageSource();
  const unsubscribeError = new Error('Unsubscribe failed.');
  let emptyCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => [{...FIRST_PROPERTY, value: true, code: 0}],
    async () => true,
    () => {
      emptyCount++;
    },
  );
  const subscription = await channel.subscribe(
    {snapshotProperties: [FIRST_PROPERTY]},
    {},
  );

  source.unsubscribeError = unsubscribeError;

  await expect(subscription.dispose()).rejects.toBe(unsubscribeError);
  expect(source.unsubscribeCount).toBe(1);
  expect(emptyCount).toBe(1);
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
      const subscription = await channel.subscribe(
        {snapshotProperties: [FIRST_PROPERTY]},
        {
          onError: () => undefined,
        },
      );

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
    .subscribe(
      {snapshotProperties: [FIRST_PROPERTY]},
      {
        onStateChanged: state => {
          states.push(state);
        },
      },
    )
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

test('keeps state and updates scoped to each listener', async () => {
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
  const secondSubscription = await channel.subscribe(
    {
      snapshotProperties: [SECOND_PROPERTY],
      notifications: [SECOND_PROPERTY_CHANGE],
    },
    {
      onStateChanged: state => {
        secondStates.push(state);
      },
      onPropertyChanged: update => {
        secondUpdates.push(update);
      },
    },
  );

  expect(source.subscribeCount).toBe(1);
  expect(firstStates[0]?.properties).toHaveLength(1);
  expect(firstStates[0]?.properties[0]).toMatchObject(FIRST_PROPERTY);
  expect(secondStates[0]?.properties).toHaveLength(1);
  expect(secondStates[0]?.properties[0]).toMatchObject(SECOND_PROPERTY);

  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: 99},
  });
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

test('does not read properties for a notification-only subscription', async () => {
  const source = createMessageSource();
  const states: CloudDeviceState[] = [];
  const notifications: CloudDeviceNotification[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;
      return [];
    },
    async () => true,
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [],
      notifications: [SECOND_PROPERTY_CHANGE],
    },
    {
      onStateChanged: state => {
        states.push(state);
      },
      onNotification: notification => {
        notifications.push(notification);
      },
    },
  );

  expect(readCount).toBe(0);
  expect(states).toEqual([{did: DID, online: true, properties: []}]);

  source.send({
    type: 'property-change',
    data: {...SECOND_PROPERTY, value: 42},
  });

  expect(notifications).toEqual([
    {
      type: 'property-change',
      data: {...SECOND_PROPERTY, value: 42, revision: 1, source: 'mqtt'},
    },
  ]);

  await subscription.dispose();
});

test.each(['online', 'read', 'result'] as const)(
  'restores notification delivery after a manual refresh $failure failure',
  async failure => {
    const propertyRead = deferred<readonly CloudPropertySnapshot[]>();
    const onlineRead = deferred<boolean>();
    const source = createMessageSource();
    const order: string[] = [];
    let propertyReadCount = 0;
    let onlineReadCount = 0;
    const channel = new CloudDeviceChannel(
      DID,
      source,
      async () => {
        propertyReadCount++;

        if (propertyReadCount === 1) {
          return [
            {...FIRST_PROPERTY, value: false, code: 0},
            {...SECOND_PROPERTY, value: 0, code: 0},
          ];
        }

        return propertyRead.promise;
      },
      async () => {
        onlineReadCount++;
        return onlineReadCount === 1 ? true : onlineRead.promise;
      },
      () => undefined,
    );
    const subscription = await channel.subscribe(
      {
        snapshotProperties: [FIRST_PROPERTY, SECOND_PROPERTY],
        notifications: [
          FIRST_PROPERTY_CHANGE,
          THIRD_PROPERTY_CHANGE,
          FIRST_EVENT,
        ],
      },
      {
        onNotification: notification => {
          order.push(
            notification.type === 'event'
              ? 'event'
              : `${notification.data.piid}:${String(notification.data.value)}`,
          );
        },
      },
    );
    const refresh = subscription.refresh();

    await waitFor(() => propertyReadCount === 2 && onlineReadCount === 2);
    source.send({
      type: 'property-change',
      data: {...FIRST_PROPERTY, value: 'before-event'},
    });
    source.send({
      type: 'property-change',
      data: {...THIRD_PROPERTY, value: 'first'},
    });
    source.send({
      type: 'event',
      data: {
        did: DID,
        siid: 2,
        eiid: 1,
        arguments: {type: 'identified', data: []},
      },
    });
    source.send({
      type: 'property-change',
      data: {...FIRST_PROPERTY, value: 'after-event'},
    });
    source.send({
      type: 'property-change',
      data: {...THIRD_PROPERTY, value: 'second'},
    });

    const refreshError = new Error(`${failure} failed.`);

    if (failure === 'online') {
      propertyRead.resolve([
        {...FIRST_PROPERTY, value: true, code: 0},
        {...SECOND_PROPERTY, value: 1, code: 0},
      ]);
      onlineRead.reject(refreshError);
    } else if (failure === 'read') {
      propertyRead.reject(refreshError);
      onlineRead.resolve(true);
    } else {
      propertyRead.resolve([
        {...FIRST_PROPERTY, value: true, code: 0},
        {...SECOND_PROPERTY, code: -1},
      ]);
      onlineRead.resolve(true);
    }

    if (failure === 'result') {
      await expect(refresh).rejects.toThrow(
        'Cloud snapshot property 2.2 failed: -1.',
      );
    } else {
      await expect(refresh).rejects.toBe(refreshError);
    }

    expect(order).toEqual([
      '1:before-event',
      '3:first',
      'event',
      '1:after-event',
      '3:second',
    ]);

    source.send({
      type: 'property-change',
      data: {...THIRD_PROPERTY, value: 'live'},
    });
    expect(order.at(-1)).toBe('3:live');

    await subscription.dispose();
  },
);

test('publishes notification-only reconnect state before a sibling snapshot read completes', async () => {
  const snapshot = deferred<readonly CloudPropertySnapshot[]>();
  const source = createMessageSource();
  const snapshotStates: CloudDeviceState[] = [];
  const notificationStates: CloudDeviceState[] = [];
  const notifications: CloudDeviceNotification[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount === 1) {
        return [{...FIRST_PROPERTY, value: false, code: 0}];
      }

      return snapshot.promise;
    },
    async () => true,
    () => undefined,
  );
  const snapshotSubscription = await channel.subscribe(
    {snapshotProperties: [FIRST_PROPERTY]},
    {
      onStateChanged: state => {
        snapshotStates.push(state);
      },
      onError: () => undefined,
    },
  );
  const notificationSubscription = await channel.subscribe(
    {
      snapshotProperties: [],
      notifications: [SECOND_PROPERTY_CHANGE, FIRST_EVENT],
    },
    {
      onStateChanged: state => {
        notificationStates.push(state);
      },
      onNotification: notification => {
        notifications.push(notification);
      },
      onError: () => undefined,
    },
  );

  channel.handleConnectionState(false);
  channel.handleConnectionState(true);
  await waitFor(() => readCount === 2 && notificationStates.length === 2);

  expect(snapshotStates).toHaveLength(1);
  expect(notificationStates.at(-1)).toEqual({
    did: DID,
    online: true,
    properties: [],
  });

  source.send({
    type: 'property-change',
    data: {...SECOND_PROPERTY, value: 42},
  });
  source.send({
    type: 'event',
    data: {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {type: 'identified', data: []},
    },
  });

  expect(notifications).toEqual([
    {
      type: 'property-change',
      data: {...SECOND_PROPERTY, value: 42, revision: 2, source: 'mqtt'},
    },
    {
      type: 'event',
      data: {
        did: DID,
        siid: 2,
        eiid: 1,
        arguments: {type: 'identified', data: []},
      },
    },
  ]);

  snapshot.resolve([{...FIRST_PROPERTY, value: true, code: 0}]);
  await waitFor(() => snapshotStates.length === 2);

  await snapshotSubscription.dispose();
  await notificationSubscription.dispose();
});

test('keeps notification-only listeners live when a sibling snapshot read fails', async () => {
  const source = createMessageSource();
  const snapshotError = new Error('Snapshot failed.');
  const snapshotStates: CloudDeviceState[] = [];
  const notificationStates: CloudDeviceState[] = [];
  const notifications: CloudDeviceNotification[] = [];
  const snapshotErrors: unknown[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount > 1) {
        throw snapshotError;
      }

      return [{...FIRST_PROPERTY, value: true, code: 0}];
    },
    async () => true,
    () => undefined,
  );
  const snapshotSubscription = await channel.subscribe(
    {snapshotProperties: [FIRST_PROPERTY]},
    {
      onStateChanged: state => {
        snapshotStates.push(state);
      },
      onError: error => {
        snapshotErrors.push(error);
      },
    },
  );
  const notificationSubscription = await channel.subscribe(
    {
      snapshotProperties: [],
      notifications: [SECOND_PROPERTY_CHANGE, FIRST_EVENT],
    },
    {
      onStateChanged: state => {
        notificationStates.push(state);
      },
      onNotification: notification => {
        notifications.push(notification);
      },
      onError: () => undefined,
    },
  );

  channel.handleConnectionState(false);
  channel.handleConnectionState(true);
  await waitFor(() => snapshotErrors.length === 1);

  expect(snapshotErrors).toEqual([snapshotError]);
  expect(snapshotStates).toHaveLength(1);
  expect(notificationStates).toEqual([
    {did: DID, online: true, properties: []},
    {did: DID, online: true, properties: []},
  ]);

  source.send({
    type: 'property-change',
    data: {...SECOND_PROPERTY, value: 42},
  });
  source.send({
    type: 'event',
    data: {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {type: 'identified', data: []},
    },
  });

  expect(notifications).toEqual([
    {
      type: 'property-change',
      data: {...SECOND_PROPERTY, value: 42, revision: 2, source: 'mqtt'},
    },
    {
      type: 'event',
      data: {
        did: DID,
        siid: 2,
        eiid: 1,
        arguments: {type: 'identified', data: []},
      },
    },
  ]);

  await snapshotSubscription.dispose();
  await notificationSubscription.dispose();
});

test('replays property changes and events in arrival order after an in-flight snapshot', async () => {
  const snapshot = deferred<readonly CloudPropertySnapshot[]>();
  const source = createMessageSource();
  const order: string[] = [];
  const states: CloudDeviceState[] = [];
  const notifications: CloudDeviceNotification[] = [];
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
  const subscriptionPromise = channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [
        FIRST_PROPERTY_CHANGE,
        FIRST_EVENT,
        SECOND_PROPERTY_CHANGE,
      ],
    },
    {
      onStateChanged: state => {
        order.push('state');
        states.push(state);
      },
      onNotification: notification => {
        order.push(notification.type);
        notifications.push(notification);
      },
    },
  );

  await waitFor(() => readCount === 1);
  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: true},
  });
  source.send({
    type: 'event',
    data: {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {
        type: 'identified',
        data: [{piid: 1, value: 'motion'}],
      },
    },
  });
  source.send({
    type: 'property-change',
    data: {...SECOND_PROPERTY, value: 42},
  });

  expect(order).toEqual([]);

  snapshot.resolve([{...FIRST_PROPERTY, value: false, code: 0}]);
  const subscription = await subscriptionPromise;

  expect(order).toEqual(['state', 'event', 'property-change']);
  expect(states).toEqual([
    {
      did: DID,
      online: true,
      properties: [
        {...FIRST_PROPERTY, value: true, source: 'mqtt', revision: 1},
      ],
    },
  ]);
  expect(notifications).toEqual([
    {
      type: 'event',
      data: {
        did: DID,
        siid: 2,
        eiid: 1,
        arguments: {
          type: 'identified',
          data: [{piid: 1, value: 'motion'}],
        },
      },
    },
    {
      type: 'property-change',
      data: {...SECOND_PROPERTY, value: 42, source: 'mqtt', revision: 2},
    },
  ]);

  await subscription.dispose();
});

test('absorbs buffered snapshot-property notifications into the published state', async () => {
  const snapshot = deferred<readonly CloudPropertySnapshot[]>();
  const source = createMessageSource();
  const states: CloudDeviceState[] = [];
  const notifications: CloudDeviceNotification[] = [];
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
  const subscriptionPromise = channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [
        FIRST_PROPERTY_CHANGE,
        SECOND_PROPERTY_CHANGE,
        FIRST_EVENT,
      ],
    },
    {
      onStateChanged: state => {
        states.push(state);
      },
      onNotification: notification => {
        notifications.push(notification);
      },
    },
  );

  await waitFor(() => readCount === 1);
  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: 'first'},
  });
  source.send({
    type: 'property-change',
    data: {...SECOND_PROPERTY, value: 1},
  });
  source.send({
    type: 'event',
    data: {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {type: 'identified', data: []},
    },
  });
  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: 'latest'},
  });
  source.send({
    type: 'property-change',
    data: {...SECOND_PROPERTY, value: 2},
  });
  snapshot.resolve([{...FIRST_PROPERTY, value: 'snapshot', code: 0}]);

  const subscription = await subscriptionPromise;

  expect(states).toEqual([
    {
      did: DID,
      online: true,
      properties: [
        {
          ...FIRST_PROPERTY,
          value: 'latest',
          revision: 3,
          source: 'mqtt',
        },
      ],
    },
  ]);
  expect(notifications).toEqual([
    {
      type: 'property-change',
      data: {...SECOND_PROPERTY, value: 1, revision: 2, source: 'mqtt'},
    },
    {
      type: 'event',
      data: {
        did: DID,
        siid: 2,
        eiid: 1,
        arguments: {type: 'identified', data: []},
      },
    },
    {
      type: 'property-change',
      data: {...SECOND_PROPERTY, value: 2, revision: 4, source: 'mqtt'},
    },
  ]);

  await subscription.dispose();
});

test('replays a snapshot-property notification produced by the state callback', async () => {
  const source = createMessageSource();
  const states: CloudDeviceState[] = [];
  const notifications: CloudDeviceNotification[] = [];
  let sentNotification = false;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => [{...FIRST_PROPERTY, value: false, code: 0}],
    async () => true,
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [FIRST_PROPERTY_CHANGE],
    },
    {
      onStateChanged: state => {
        states.push(state);

        if (!sentNotification) {
          sentNotification = true;
          source.send({
            type: 'property-change',
            data: {...FIRST_PROPERTY, value: true},
          });
        }
      },
      onNotification: notification => {
        notifications.push(notification);
      },
    },
  );

  expect(states).toEqual([
    {
      did: DID,
      online: true,
      properties: [
        {...FIRST_PROPERTY, value: false, revision: 1, source: 'snapshot'},
      ],
    },
  ]);
  expect(notifications).toEqual([
    {
      type: 'property-change',
      data: {...FIRST_PROPERTY, value: true, revision: 2, source: 'mqtt'},
    },
  ]);

  await subscription.dispose();
});

test('carries only refresh-independent notifications into a replacement', async () => {
  const olderSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const newerSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const source = createMessageSource();
  const notifications: CloudDeviceNotification[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount === 1) {
        return [{...FIRST_PROPERTY, value: false, code: 0}];
      } else if (readCount === 2) {
        return olderSnapshot.promise;
      }

      return newerSnapshot.promise;
    },
    async () => true,
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [
        FIRST_PROPERTY_CHANGE,
        SECOND_PROPERTY_CHANGE,
        FIRST_EVENT,
      ],
    },
    {
      onNotification: notification => {
        notifications.push(notification);
      },
    },
  );
  const olderRefresh = subscription.refresh();

  await waitFor(() => readCount === 2);
  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: 'old snapshot property'},
  });
  source.send({
    type: 'property-change',
    data: {...SECOND_PROPERTY, value: 'old'},
  });
  source.send({
    type: 'event',
    data: {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {
        type: 'identified',
        data: [{piid: 1, value: 'old'}],
      },
    },
  });

  const newerRefresh = subscription.refresh();

  await waitFor(() => readCount === 3);
  source.send({
    type: 'property-change',
    data: {...SECOND_PROPERTY, value: 'new'},
  });
  source.send({
    type: 'event',
    data: {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {
        type: 'identified',
        data: [{piid: 1, value: 'new'}],
      },
    },
  });
  newerSnapshot.resolve([{...FIRST_PROPERTY, value: true, code: 0}]);

  await newerRefresh;
  await olderRefresh;
  olderSnapshot.resolve([{...FIRST_PROPERTY, value: false, code: 0}]);
  await Promise.resolve();

  expect(notifications).toEqual([
    {
      type: 'property-change',
      data: {...SECOND_PROPERTY, value: 'old', revision: 3, source: 'mqtt'},
    },
    {
      type: 'event',
      data: {
        did: DID,
        siid: 2,
        eiid: 1,
        arguments: {
          type: 'identified',
          data: [{piid: 1, value: 'old'}],
        },
      },
    },
    {
      type: 'property-change',
      data: {...SECOND_PROPERTY, value: 'new', revision: 4, source: 'mqtt'},
    },
    {
      type: 'event',
      data: {
        did: DID,
        siid: 2,
        eiid: 1,
        arguments: {
          type: 'identified',
          data: [{piid: 1, value: 'new'}],
        },
      },
    },
  ]);

  await subscription.dispose();
});

test('routes events only to listeners subscribed to the matching event', async () => {
  const source = createMessageSource();
  const firstEvents: unknown[] = [];
  const secondEvents: unknown[] = [];
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => [{...FIRST_PROPERTY, value: true, code: 0}],
    async () => true,
    () => undefined,
  );
  const firstSubscription = await channel.subscribe(
    {snapshotProperties: [], notifications: [FIRST_EVENT]},
    {
      onEventOccurred: event => {
        firstEvents.push(event);
      },
    },
  );
  const secondSubscription = await channel.subscribe(
    {snapshotProperties: [FIRST_PROPERTY]},
    {
      onEventOccurred: event => {
        secondEvents.push(event);
      },
    },
  );

  source.send({
    type: 'event',
    data: {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {
        type: 'identified',
        data: [{piid: 7, value: 'event'}],
      },
    },
  });
  source.send({
    type: 'event',
    data: {
      did: DID,
      siid: 2,
      eiid: 2,
      arguments: {type: 'identified', data: []},
    },
  });

  expect(firstEvents).toEqual([
    {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {
        type: 'identified',
        data: [{piid: 7, value: 'event'}],
      },
    },
  ]);
  expect(secondEvents).toEqual([]);

  await firstSubscription.dispose();
  await secondSubscription.dispose();
});

test('buffers subscribed events until the subscription initializes', async () => {
  const online = deferred<boolean>();
  const source = createMessageSource();
  const events: unknown[] = [];
  const states: CloudDeviceState[] = [];
  let onlineReadCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      throw new Error('Event-only subscriptions do not read properties.');
    },
    async () => {
      onlineReadCount++;
      return online.promise;
    },
    () => undefined,
  );
  const subscriptionPromise = channel.subscribe(
    {snapshotProperties: [], notifications: [FIRST_EVENT]},
    {
      onStateChanged: state => {
        states.push(state);
      },
      onEventOccurred: event => {
        events.push(event);
      },
    },
  );

  await waitFor(() => onlineReadCount === 1);
  source.send({
    type: 'event',
    data: {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {
        type: 'identified',
        data: [{piid: 1, value: 'event'}],
      },
    },
  });

  expect(events).toEqual([]);

  online.resolve(true);

  const subscription = await subscriptionPromise;

  expect(states).toEqual([{did: DID, online: true, properties: []}]);
  expect(events).toEqual([
    {
      did: DID,
      siid: 2,
      eiid: 1,
      arguments: {
        type: 'identified',
        data: [{piid: 1, value: 'event'}],
      },
    },
  ]);

  await subscription.dispose();
});

function createMessageSource(): TestMessageSource {
  let handler: CloudMqttDeviceMessageHandler | undefined;

  return {
    subscribeCount: 0,
    unsubscribeCount: 0,
    unsubscribeError: undefined,
    async subscribeDevice(_did, nextHandler) {
      this.subscribeCount++;
      handler = nextHandler;
    },
    async unsubscribeDevice(_did) {
      this.unsubscribeCount++;

      if (this.unsubscribeError !== undefined) {
        throw this.unsubscribeError;
      }
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
  unsubscribeError: Error | undefined;
  send(message: Parameters<CloudMqttDeviceMessageHandler>[0]): void;
};

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: value => {
      if (resolvePromise === undefined) {
        throw new Error('Deferred promise is missing its resolver.');
      }

      resolvePromise(value);
    },
    reject: error => {
      if (rejectPromise === undefined) {
        throw new Error('Deferred promise is missing its rejecter.');
      }

      rejectPromise(error);
    },
  };
}

type Deferred<T> = {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
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
