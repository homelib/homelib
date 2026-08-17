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

test('publishes selected snapshots before replaying buffered property changes', async () => {
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
  const updates: CloudPropertyUpdate[] = [];
  const subscriptionPromise = channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [FIRST_PROPERTY_CHANGE],
      replaySnapshotPropertyNotifications: [FIRST_PROPERTY],
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
    data: {...FIRST_PROPERTY, value: 5},
  });
  snapshot.resolve([{...FIRST_PROPERTY, value: 1, code: 0}]);

  const subscription = await subscriptionPromise;

  expect(states).toEqual([
    {
      did: DID,
      online: true,
      properties: [
        {
          ...FIRST_PROPERTY,
          value: 1,
          revision: 1,
          source: 'snapshot',
        },
      ],
    },
  ]);
  expect(updates).toEqual([
    {
      ...FIRST_PROPERTY,
      value: 5,
      revision: 2,
      source: 'mqtt',
    },
  ]);

  await subscription.dispose();
});

test('absorbs selected property changes that precede the snapshot baseline', async () => {
  const updates: CloudPropertyUpdate[] = [];
  const states: CloudDeviceState[] = [];
  const source: CloudDeviceMessageSource = {
    async subscribeDevice(_did, handler) {
      handler({
        type: 'property-change',
        data: {...FIRST_PROPERTY, value: 5},
      });
    },
    async unsubscribeDevice() {},
  };
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => [{...FIRST_PROPERTY, value: 1, code: 0}],
    async () => true,
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [FIRST_PROPERTY_CHANGE],
      replaySnapshotPropertyNotifications: [FIRST_PROPERTY],
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

  expect(states.at(-1)).toMatchObject({
    did: DID,
    online: true,
    properties: [{...FIRST_PROPERTY, value: 1, source: 'snapshot'}],
  });
  expect(updates).toEqual([]);

  await subscription.dispose();
});

test('replays only selected property changes newer than a replacement snapshot baseline', async () => {
  const olderSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const newerSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const source = createMessageSource();
  const states: CloudDeviceState[] = [];
  const updates: CloudPropertyUpdate[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount === 1) {
        return [{...FIRST_PROPERTY, value: 0, code: 0}];
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
      notifications: [FIRST_PROPERTY_CHANGE],
      replaySnapshotPropertyNotifications: [FIRST_PROPERTY],
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
  const olderRefresh = subscription.refresh();

  await waitFor(() => readCount === 2);
  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: 5},
  });

  const newerRefresh = subscription.refresh();

  await waitFor(() => readCount === 3);
  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: 1},
  });
  newerSnapshot.resolve([{...FIRST_PROPERTY, value: 0, code: 0}]);

  await newerRefresh;
  await olderRefresh;
  olderSnapshot.resolve([{...FIRST_PROPERTY, value: 1, code: 0}]);
  await Promise.resolve();

  expect(states.at(-1)).toMatchObject({
    did: DID,
    online: true,
    properties: [{...FIRST_PROPERTY, value: 0, source: 'snapshot'}],
  });
  expect(updates).toEqual([
    expect.objectContaining({
      ...FIRST_PROPERTY,
      value: 1,
      source: 'mqtt',
    }),
  ]);
  expect(updates[0]?.revision).toBeGreaterThan(
    states.at(-1)?.properties[0]?.revision ?? 0,
  );

  await subscription.dispose();
});

test('replays a selected property change after a sibling newer snapshot supersedes a failed read', async () => {
  const olderSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const newerSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const olderError = new Error('Older snapshot failed.');
  const source = createMessageSource();
  const firstStates: CloudDeviceState[] = [];
  const firstUpdates: CloudPropertyUpdate[] = [];
  const firstErrors: unknown[] = [];
  const secondUpdates: CloudPropertyUpdate[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount <= 2) {
        return [{...FIRST_PROPERTY, value: 0, code: 0}];
      } else if (readCount === 3) {
        return olderSnapshot.promise;
      }

      return newerSnapshot.promise;
    },
    async () => true,
    () => undefined,
  );
  const request = {
    snapshotProperties: [FIRST_PROPERTY],
    notifications: [FIRST_PROPERTY_CHANGE],
    replaySnapshotPropertyNotifications: [FIRST_PROPERTY],
  } as const;
  const firstSubscription = await channel.subscribe(request, {
    onStateChanged: state => {
      firstStates.push(state);
    },
    onPropertyChanged: update => {
      firstUpdates.push(update);
    },
    onError: error => {
      firstErrors.push(error);
    },
  });
  const secondSubscription = await channel.subscribe(request, {
    onPropertyChanged: update => {
      secondUpdates.push(update);
    },
  });
  const olderRefresh = firstSubscription.refresh();

  await waitFor(() => readCount === 3);
  const newerRefresh = secondSubscription.refresh();
  await waitFor(() => readCount === 4);

  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: 5},
  });
  newerSnapshot.resolve([{...FIRST_PROPERTY, value: 1, code: 0}]);
  await newerRefresh;

  olderSnapshot.reject(olderError);
  await olderRefresh;

  expect(secondUpdates).toEqual([
    expect.objectContaining({
      ...FIRST_PROPERTY,
      value: 5,
      source: 'mqtt',
    }),
  ]);
  expect(firstStates.at(-1)).toMatchObject({
    online: true,
    properties: [],
    invalidatedProperties: [FIRST_PROPERTY],
  });
  expect(firstUpdates).toEqual([
    expect.objectContaining({
      ...FIRST_PROPERTY,
      value: 5,
      source: 'mqtt',
    }),
  ]);
  expect(firstErrors).toEqual([olderError]);

  await firstSubscription.dispose();
  await secondSubscription.dispose();
});

test('replays a selected property change after a sibling newer snapshot supersedes a successful read', async () => {
  import.meta.jest.useFakeTimers();

  const olderSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const newerSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const source = createMessageSource();
  const firstStates: CloudDeviceState[] = [];
  const firstUpdates: CloudPropertyUpdate[] = [];
  const firstErrors: unknown[] = [];
  const secondUpdates: CloudPropertyUpdate[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount <= 2) {
        return [{...FIRST_PROPERTY, value: 0, code: 0}];
      } else if (readCount === 3) {
        return olderSnapshot.promise;
      }

      return newerSnapshot.promise;
    },
    async () => true,
    () => undefined,
  );
  const request = {
    snapshotProperties: [FIRST_PROPERTY],
    notifications: [FIRST_PROPERTY_CHANGE],
    replaySnapshotPropertyNotifications: [FIRST_PROPERTY],
  } as const;

  try {
    const firstSubscription = await channel.subscribe(request, {
      onStateChanged: state => {
        firstStates.push(state);
      },
      onPropertyChanged: update => {
        firstUpdates.push(update);
      },
      onError: error => {
        firstErrors.push(error);
      },
    });
    const secondSubscription = await channel.subscribe(request, {
      onPropertyChanged: update => {
        secondUpdates.push(update);
      },
    });
    const olderRefresh = firstSubscription.refresh();

    await waitFor(() => readCount === 3);
    const newerRefresh = secondSubscription.refresh();
    await waitFor(() => readCount === 4);

    source.send({
      type: 'property-change',
      data: {...FIRST_PROPERTY, value: 5},
    });
    newerSnapshot.resolve([{...FIRST_PROPERTY, value: 1, code: 0}]);
    await newerRefresh;

    olderSnapshot.resolve([{...FIRST_PROPERTY, value: 2, code: 0}]);
    await olderRefresh;

    expect(secondUpdates).toEqual([
      expect.objectContaining({
        ...FIRST_PROPERTY,
        value: 5,
        source: 'mqtt',
      }),
    ]);
    expect(firstStates.at(-1)).toMatchObject({
      online: true,
      properties: [],
      invalidatedProperties: [FIRST_PROPERTY],
    });
    expect(firstUpdates).toEqual([
      expect.objectContaining({
        ...FIRST_PROPERTY,
        value: 5,
        source: 'mqtt',
      }),
    ]);
    expect(firstErrors).toEqual([]);
    expect(import.meta.jest.getTimerCount()).toBe(0);

    await firstSubscription.dispose();
    await secondSubscription.dispose();
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test('initializes from a partial snapshot when a property is unavailable', async () => {
  const source = createMessageSource();
  const states: CloudDeviceState[] = [];
  const independentInvalidations: Array<readonly unknown[]> = [];
  const errors: unknown[] = [];
  const reads: Array<readonly unknown[]> = [];
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async properties => {
      reads.push(properties);
      return [
        {...FIRST_PROPERTY, value: true, code: 0},
        {...SECOND_PROPERTY, code: -704220043},
      ];
    },
    async () => true,
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY, SECOND_PROPERTY],
      notifications: [SECOND_PROPERTY_CHANGE],
      replaySnapshotPropertyNotifications: [SECOND_PROPERTY],
    },
    {
      onStateChanged: state => {
        states.push(state);
      },
      onSnapshotInvalidated: properties => {
        independentInvalidations.push(properties);
      },
      onError: error => {
        errors.push(error);
      },
    },
  );

  expect(reads).toEqual([[FIRST_PROPERTY, SECOND_PROPERTY]]);
  expect(states).toHaveLength(1);
  expect(states[0]).toMatchObject({
    did: DID,
    online: true,
    properties: [{...FIRST_PROPERTY, value: true, source: 'snapshot'}],
  });
  expect(states[0]?.invalidatedProperties).toBeUndefined();
  expect(independentInvalidations).toEqual([]);
  expect(errors).toEqual([]);

  await subscription.dispose();
});

test('retries an unavailable snapshot property silently in the background', async () => {
  import.meta.jest.useFakeTimers();

  const source = createMessageSource();
  const states: CloudDeviceState[] = [];
  const errors: unknown[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      return readCount === 1
        ? [
            {...FIRST_PROPERTY, value: true, code: 0},
            {...SECOND_PROPERTY, code: -704220043},
          ]
        : [
            {...FIRST_PROPERTY, value: true, code: 0},
            {...SECOND_PROPERTY, value: 42, code: 0},
          ];
    },
    async () => true,
    () => undefined,
  );

  try {
    const subscription = await channel.subscribe(
      {snapshotProperties: [FIRST_PROPERTY, SECOND_PROPERTY]},
      {
        onStateChanged: state => {
          states.push(state);
        },
        onError: error => {
          errors.push(error);
        },
      },
    );

    expect(states.at(-1)?.properties).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(import.meta.jest.getTimerCount()).toBe(1);

    await import.meta.jest.advanceTimersByTimeAsync(
      CLOUD_MQTT_RECONNECT_INTERVAL,
    );
    await waitFor(() => states.length === 2);

    expect(states.at(-1)).toMatchObject({
      online: true,
      properties: [
        {...FIRST_PROPERTY, value: true, source: 'snapshot'},
        {...SECOND_PROPERTY, value: 42, source: 'snapshot'},
      ],
    });
    expect(errors).toEqual([]);
    expect(import.meta.jest.getTimerCount()).toBe(0);

    await subscription.dispose();
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test('schedules a new entry retry when it fails while an older retry settles', async () => {
  import.meta.jest.useFakeTimers();

  const firstRetry = deferred<readonly CloudPropertySnapshot[]>();
  const secondFailure = deferred<readonly CloudPropertySnapshot[]>();
  const source = createMessageSource();
  const secondStates: CloudDeviceState[] = [];
  let firstReadCount = 0;
  let secondReadCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async properties => {
      if (properties[0]?.piid === FIRST_PROPERTY.piid) {
        firstReadCount++;

        if (firstReadCount === 2) {
          return [{...FIRST_PROPERTY, code: -704220043}];
        } else if (firstReadCount === 3) {
          return firstRetry.promise;
        }

        return [{...FIRST_PROPERTY, value: firstReadCount, code: 0}];
      }

      secondReadCount++;

      if (secondReadCount === 2) {
        return secondFailure.promise;
      }

      return [{...SECOND_PROPERTY, value: secondReadCount, code: 0}];
    },
    async () => true,
    () => undefined,
  );

  try {
    const firstSubscription = await channel.subscribe(
      {snapshotProperties: [FIRST_PROPERTY]},
      {},
    );
    const secondSubscription = await channel.subscribe(
      {snapshotProperties: [SECOND_PROPERTY]},
      {
        onStateChanged: state => {
          secondStates.push(state);
        },
      },
    );

    await firstSubscription.refresh();
    expect(import.meta.jest.getTimerCount()).toBe(1);

    await import.meta.jest.advanceTimersByTimeAsync(
      CLOUD_MQTT_RECONNECT_INTERVAL,
    );
    await waitFor(() => firstReadCount === 3);

    const secondRefresh = secondSubscription.refresh();
    await waitFor(() => secondReadCount === 2);

    firstRetry.resolve([{...FIRST_PROPERTY, value: 3, code: 0}]);
    secondFailure.resolve([{...SECOND_PROPERTY, code: -704220043}]);
    await secondRefresh;
    await waitFor(() => import.meta.jest.getTimerCount() === 1);

    await import.meta.jest.advanceTimersByTimeAsync(
      CLOUD_MQTT_RECONNECT_INTERVAL,
    );
    await waitFor(() => secondReadCount === 3);

    expect(secondStates.at(-1)).toMatchObject({
      online: true,
      properties: [{...SECOND_PROPERTY, value: 3, source: 'snapshot'}],
    });
    expect(import.meta.jest.getTimerCount()).toBe(0);

    await firstSubscription.dispose();
    await secondSubscription.dispose();
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test('invalidates a stale snapshot value and restores it after recovery', async () => {
  const source = createMessageSource();
  const states: CloudDeviceState[] = [];
  const independentInvalidations: Array<readonly unknown[]> = [];
  const errors: unknown[] = [];
  const order: string[] = [];
  let results: readonly CloudPropertySnapshot[] = [
    {...FIRST_PROPERTY, value: 1, code: 0},
    {...SECOND_PROPERTY, value: 2, code: 0},
  ];
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => results,
    async () => true,
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY, SECOND_PROPERTY],
    },
    {
      onStateChanged: state => {
        states.push(state);
        order.push(
          `state:${state.properties.map(property => property.piid).join(',')}:${
            state.invalidatedProperties
              ?.map(property => property.piid)
              .join(',') ?? ''
          }`,
        );
      },
      onSnapshotInvalidated: properties => {
        independentInvalidations.push(properties);
      },
      onError: error => {
        errors.push(error);
      },
    },
  );

  results = [
    {...FIRST_PROPERTY, value: 3, code: 0},
    {...SECOND_PROPERTY, code: -704220043},
  ];
  await subscription.refresh();

  expect(order).toEqual(['state:1,2:', 'state:1:2']);
  expect(independentInvalidations).toEqual([]);
  expect(states.at(-1)).toMatchObject({
    online: true,
    properties: [{...FIRST_PROPERTY, value: 3, source: 'snapshot'}],
    invalidatedProperties: [SECOND_PROPERTY],
  });
  expect(errors).toEqual([]);

  results = [
    {...FIRST_PROPERTY, value: 4, code: 0},
    {...SECOND_PROPERTY, value: 5, code: 0},
  ];
  await subscription.refresh();

  expect(order.at(-1)).toBe('state:1,2:');
  expect(independentInvalidations).toHaveLength(0);
  expect(states.at(-1)).toMatchObject({
    online: true,
    properties: [
      {...FIRST_PROPERTY, value: 4, source: 'snapshot'},
      {...SECOND_PROPERTY, value: 5, source: 'snapshot'},
    ],
  });
  expect(errors).toEqual([]);

  await subscription.dispose();
});

test('invalidates a snapshot property only after it was delivered', async () => {
  const source = createMessageSource();
  const states: CloudDeviceState[] = [];
  const updates: CloudPropertyUpdate[] = [];
  const independentInvalidations: Array<readonly unknown[]> = [];
  const errors: unknown[] = [];
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => [{...SECOND_PROPERTY, code: -704220043}],
    async () => true,
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [SECOND_PROPERTY],
      notifications: [SECOND_PROPERTY_CHANGE],
    },
    {
      onStateChanged: state => {
        states.push(state);
      },
      onPropertyChanged: update => {
        updates.push(update);
      },
      onSnapshotInvalidated: properties => {
        independentInvalidations.push(properties);
      },
      onError: error => {
        errors.push(error);
      },
    },
  );

  expect(states).toHaveLength(1);
  expect(states[0]?.invalidatedProperties).toBeUndefined();

  await subscription.refresh();
  expect(states).toHaveLength(2);
  expect(states[1]?.invalidatedProperties).toBeUndefined();

  source.send({
    type: 'property-change',
    data: {...SECOND_PROPERTY, value: 5},
  });
  expect(updates).toHaveLength(1);

  await subscription.refresh();
  expect(states).toHaveLength(3);
  expect(states[2]).toMatchObject({
    online: true,
    properties: [],
    invalidatedProperties: [SECOND_PROPERTY],
  });

  await subscription.refresh();
  expect(states).toHaveLength(4);
  expect(states[3]?.invalidatedProperties).toBeUndefined();
  expect(independentInvalidations).toEqual([]);
  expect(errors).toEqual([]);

  await subscription.dispose();
});

test('preserves snapshot availability offline so reconnect can invalidate it', async () => {
  const source = createMessageSource();
  const states: CloudDeviceState[] = [];
  const errors: unknown[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;
      return readCount === 1
        ? [
            {...FIRST_PROPERTY, value: true, code: 0},
            {...SECOND_PROPERTY, value: 2, code: 0},
          ]
        : [
            {...FIRST_PROPERTY, value: false, code: 0},
            {...SECOND_PROPERTY, code: -704220043},
          ];
    },
    async () => true,
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY, SECOND_PROPERTY],
    },
    {
      onStateChanged: state => {
        states.push(state);
      },
      onError: error => {
        errors.push(error);
      },
    },
  );

  source.send({type: 'state', data: {did: DID, online: false}});
  await waitFor(() => states.length === 2);
  expect(states.at(-1)).toEqual({did: DID, online: false, properties: []});

  source.send({type: 'state', data: {did: DID, online: true}});
  await waitFor(() => states.length === 3);

  expect(states.at(-1)).toMatchObject({
    online: true,
    properties: [{...FIRST_PROPERTY, value: false, source: 'snapshot'}],
    invalidatedProperties: [SECOND_PROPERTY],
  });
  expect(errors).toEqual([]);

  await subscription.dispose();
});

test('publishes unavailable snapshot properties silently to every listener during reconnect', async () => {
  const source = createMessageSource();
  const firstStates: CloudDeviceState[] = [];
  const secondStates: CloudDeviceState[] = [];
  const firstInvalidations: Array<readonly unknown[]> = [];
  const secondInvalidations: Array<readonly unknown[]> = [];
  const firstErrors: unknown[] = [];
  const secondErrors: unknown[] = [];
  let failSnapshot = false;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => [
      failSnapshot
        ? {...SECOND_PROPERTY, code: -704220043}
        : {...SECOND_PROPERTY, value: 2, code: 0},
    ],
    async () => true,
    () => undefined,
  );
  const firstSubscription = await channel.subscribe(
    {snapshotProperties: [SECOND_PROPERTY]},
    {
      onStateChanged: state => {
        firstStates.push(state);
      },
      onSnapshotInvalidated: properties => {
        firstInvalidations.push(properties);
      },
      onError: error => {
        firstErrors.push(error);
      },
    },
  );
  const secondSubscription = await channel.subscribe(
    {
      snapshotProperties: [SECOND_PROPERTY],
    },
    {
      onStateChanged: state => {
        secondStates.push(state);
      },
      onSnapshotInvalidated: properties => {
        secondInvalidations.push(properties);
      },
      onError: error => {
        secondErrors.push(error);
      },
    },
  );

  failSnapshot = true;
  channel.handleConnectionState(false);
  channel.handleConnectionState(true);
  await waitFor(() => firstStates.length === 2 && secondStates.length === 2);

  expect(firstStates.at(-1)).toMatchObject({
    online: true,
    properties: [],
    invalidatedProperties: [SECOND_PROPERTY],
  });
  expect(firstInvalidations).toEqual([]);
  expect(firstErrors).toEqual([]);
  expect(secondStates.at(-1)).toMatchObject({
    online: true,
    properties: [],
    invalidatedProperties: [SECOND_PROPERTY],
  });
  expect(secondInvalidations).toEqual([]);
  expect(secondErrors).toEqual([]);

  await firstSubscription.dispose();
  await secondSubscription.dispose();
});

test('reports a duplicate snapshot result only to the refreshed listener', async () => {
  const source = createMessageSource();
  const firstStates: CloudDeviceState[] = [];
  const firstErrors: unknown[] = [];
  const secondErrors: unknown[] = [];
  let firstReadCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async properties => {
      if (properties[0]?.piid === FIRST_PROPERTY.piid) {
        firstReadCount++;

        if (firstReadCount === 2) {
          return [
            {...FIRST_PROPERTY, value: 2, code: 0},
            {...FIRST_PROPERTY, value: 3, code: 0},
          ];
        }

        return [{...FIRST_PROPERTY, value: 1, code: 0}];
      }

      return [{...SECOND_PROPERTY, value: 2, code: 0}];
    },
    async () => true,
    () => undefined,
  );
  const firstSubscription = await channel.subscribe(
    {snapshotProperties: [FIRST_PROPERTY]},
    {
      onStateChanged: state => {
        firstStates.push(state);
      },
      onError: error => {
        firstErrors.push(error);
      },
    },
  );
  const secondSubscription = await channel.subscribe(
    {snapshotProperties: [SECOND_PROPERTY]},
    {
      onError: error => {
        secondErrors.push(error);
      },
    },
  );

  await firstSubscription.refresh();

  expect(firstStates.at(-1)).toMatchObject({
    online: true,
    properties: [],
    invalidatedProperties: [FIRST_PROPERTY],
  });
  expect(firstErrors.map(error => (error as Error).message)).toEqual([
    'Cloud snapshot returned duplicate property 2.1.',
  ]);
  expect(secondErrors).toEqual([]);

  await firstSubscription.dispose();
  await secondSubscription.dispose();
});

test('rejects a snapshot property for another device', async () => {
  const source = createMessageSource();
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => [],
    async () => true,
    () => undefined,
  );

  await expect(
    channel.subscribe(
      {
        snapshotProperties: [{...FIRST_PROPERTY, did: 'different-device'}],
      },
      {},
    ),
  ).rejects.toThrow(
    'Cloud device device-1 cannot subscribe to property for different-device',
  );

  expect(source.subscribeCount).toBe(0);
});

test('initializes from an incomplete state and recovers on manual refresh', async () => {
  const source = createMessageSource();
  let results: readonly CloudPropertySnapshot[] = [
    {...FIRST_PROPERTY, value: false, code: 0},
    {...SECOND_PROPERTY, code: -1},
    {...THIRD_PROPERTY, value: 'optional', code: 0},
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

  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY, SECOND_PROPERTY, THIRD_PROPERTY],
    },
    listener,
  );

  expect(states.at(-1)).toMatchObject({
    did: DID,
    online: true,
    properties: [
      {...FIRST_PROPERTY, value: false, source: 'snapshot'},
      {...THIRD_PROPERTY, value: 'optional', source: 'snapshot'},
    ],
  });
  expect(errors).toEqual([]);
  expect(source.unsubscribeCount).toBe(0);

  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: true},
  });
  expect(updates).toEqual([]);

  results = [
    {...FIRST_PROPERTY, value: true, code: 0},
    {...SECOND_PROPERTY, value: 75, code: 0},
    {...THIRD_PROPERTY, value: 'recovered', code: 0},
  ];
  await subscription.refresh();

  expect(source.subscribeCount).toBe(1);
  expect(states.at(-1)).toMatchObject({
    did: DID,
    online: true,
    properties: [
      {...FIRST_PROPERTY, value: true, source: 'snapshot'},
      {...SECOND_PROPERTY, value: 75, source: 'snapshot'},
      {...THIRD_PROPERTY, value: 'recovered', source: 'snapshot'},
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
    const errors: unknown[] = [];
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
        onError: error => {
          errors.push(error);
        },
      },
    );

    expect(states).toEqual([{did: DID, online: false, properties: []}]);
    expect(errors).toEqual([]);
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

test('initializes after a whole snapshot read failure and retries it', async () => {
  import.meta.jest.useFakeTimers();

  const source = createMessageSource();
  const snapshotError = new Error('Snapshot failed.');
  const errors: unknown[] = [];
  const states: CloudDeviceState[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount === 1) {
        throw snapshotError;
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
        onStateChanged: state => {
          states.push(state);
        },
        onError: error => {
          errors.push(error);
        },
      },
    );

    expect(states).toEqual([{did: DID, online: true, properties: []}]);
    expect(errors).toEqual([snapshotError]);
    expect(source.unsubscribeCount).toBe(0);
    expect(import.meta.jest.getTimerCount()).toBe(1);

    await import.meta.jest.advanceTimersByTimeAsync(
      CLOUD_MQTT_RECONNECT_INTERVAL,
    );
    await waitFor(() => states.length === 2);

    expect(readCount).toBe(2);
    expect(states.at(-1)).toMatchObject({
      online: true,
      properties: [{...FIRST_PROPERTY, value: true, source: 'snapshot'}],
    });
    expect(errors).toEqual([snapshotError]);
    expect(import.meta.jest.getTimerCount()).toBe(0);

    await subscription.dispose();
  } finally {
    import.meta.jest.useRealTimers();
  }
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
    await waitFor(() => import.meta.jest.getTimerCount() === 1);

    expect(readCount).toBe(2);
    expect(errors).toEqual([refreshError]);
    expect(states.at(-1)).toMatchObject({
      online: true,
      properties: [],
      invalidatedProperties: [FIRST_PROPERTY],
    });
    expect(import.meta.jest.getTimerCount()).toBe(1);

    await import.meta.jest.advanceTimersByTimeAsync(
      CLOUD_MQTT_RECONNECT_INTERVAL,
    );
    await waitFor(() => states.length === 3);

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
    await waitFor(() => import.meta.jest.getTimerCount() === 1);

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
      await waitFor(() => import.meta.jest.getTimerCount() === 1);

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

test('accepts a shared refresh response after one listener is disposed', async () => {
  const reconnectSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const source = createMessageSource();
  const reads: Array<readonly string[]> = [];
  const firstStates: CloudDeviceState[] = [];
  const secondStates: CloudDeviceState[] = [];
  const secondErrors: unknown[] = [];
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async properties => {
      reads.push(
        properties.map(property => `${property.siid}.${property.piid}`),
      );

      if (reads.length === 1) {
        return [{...FIRST_PROPERTY, value: 10, code: 0}];
      } else if (reads.length === 2) {
        return [{...SECOND_PROPERTY, value: 20, code: 0}];
      }

      return reconnectSnapshot.promise;
    },
    async () => true,
    () => undefined,
  );
  const firstSubscription = await channel.subscribe(
    {snapshotProperties: [FIRST_PROPERTY]},
    {
      onStateChanged: state => {
        firstStates.push(state);
      },
    },
  );
  const secondSubscription = await channel.subscribe(
    {snapshotProperties: [SECOND_PROPERTY]},
    {
      onStateChanged: state => {
        secondStates.push(state);
      },
      onError: error => {
        secondErrors.push(error);
      },
    },
  );

  channel.handleConnectionState(false);
  channel.handleConnectionState(true);
  await waitFor(() => reads.length === 3);
  expect(reads.at(-1)).toEqual(['2.1', '2.2']);

  await firstSubscription.dispose();
  reconnectSnapshot.resolve([
    {...FIRST_PROPERTY, value: 11, code: 0},
    {...SECOND_PROPERTY, value: 21, code: 0},
  ]);
  await waitFor(() => secondStates.length === 2);

  expect(firstStates).toHaveLength(1);
  expect(secondStates.at(-1)?.properties).toEqual([
    expect.objectContaining({...SECOND_PROPERTY, value: 21}),
  ]);
  expect(secondErrors).toEqual([]);

  await secondSubscription.dispose();
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
    const errors: unknown[] = [];
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
        onError: error => {
          errors.push(error);
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

    if (failure === 'online') {
      await expect(refresh).rejects.toBe(refreshError);
    } else {
      await expect(refresh).resolves.toBeUndefined();
    }

    expect(order).toEqual(
      failure === 'online'
        ? ['1:before-event', '3:first', 'event', '1:after-event', '3:second']
        : ['3:first', 'event', '3:second'],
    );
    expect(errors).toEqual(failure === 'read' ? [refreshError] : []);

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
  expect(snapshotStates).toHaveLength(2);
  expect(snapshotStates.at(-1)).toMatchObject({
    online: true,
    properties: [],
    invalidatedProperties: [FIRST_PROPERTY],
  });
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

test('refreshes a snapshot before delivering a selected event', async () => {
  const refreshedSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const source = createMessageSource();
  const order: string[] = [];
  const errors: unknown[] = [];
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

      return refreshedSnapshot.promise;
    },
    async () => {
      onlineReadCount++;
      return true;
    },
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [FIRST_EVENT],
      refreshSnapshotOnEvents: [FIRST_EVENT.data],
    },
    {
      onStateChanged: state => {
        order.push(`state:${String(state.properties[0]?.value)}`);
      },
      onSnapshotInvalidated: () => {
        order.push('invalidate');
      },
      onEventOccurred: () => {
        order.push('event');
      },
      onError: error => {
        errors.push(error);
      },
    },
  );

  source.send({
    type: 'event',
    data: {
      ...FIRST_EVENT.data,
      arguments: {type: 'identified', data: []},
    },
  });

  await waitFor(() => readCount === 2);
  expect(order).toEqual(['state:false']);
  expect(onlineReadCount).toBe(1);

  refreshedSnapshot.resolve([{...FIRST_PROPERTY, value: true, code: 0}]);
  await waitFor(() => order.length === 3);

  expect(order).toEqual(['state:false', 'state:true', 'event']);
  expect(errors).toEqual([]);

  await subscription.dispose();
});

test('delivers an event after a partial snapshot refresh', async () => {
  const source = createMessageSource();
  const states: CloudDeviceState[] = [];
  const order: string[] = [];
  const independentInvalidations: Array<readonly unknown[]> = [];
  const errors: unknown[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      return readCount === 1
        ? [{...FIRST_PROPERTY, value: false, code: 0}]
        : [{...FIRST_PROPERTY, code: -704220043}];
    },
    async () => true,
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [FIRST_EVENT],
      refreshSnapshotOnEvents: [FIRST_EVENT.data],
    },
    {
      onStateChanged: state => {
        states.push(state);
        order.push(
          `state:${String(state.properties[0]?.value)}:${
            state.invalidatedProperties
              ?.map(property => property.piid)
              .join(',') ?? ''
          }`,
        );
      },
      onSnapshotInvalidated: properties => {
        independentInvalidations.push(properties);
      },
      onEventOccurred: () => {
        order.push('event');
      },
      onError: error => {
        errors.push(error);
      },
    },
  );

  source.send({
    type: 'event',
    data: {
      ...FIRST_EVENT.data,
      arguments: {type: 'identified', data: []},
    },
  });
  await waitFor(() => order.length === 3);

  expect(order).toEqual(['state:false:', 'state:undefined:1', 'event']);
  expect(states.at(-1)).toMatchObject({
    online: true,
    properties: [],
    invalidatedProperties: [FIRST_PROPERTY],
  });
  expect(independentInvalidations).toEqual([]);
  expect(errors).toEqual([]);

  await subscription.dispose();
});

test('publishes unavailable event snapshots independently to each listener', async () => {
  const source = createMessageSource();
  const firstStates: CloudDeviceState[] = [];
  const secondStates: CloudDeviceState[] = [];
  const firstInvalidations: Array<readonly unknown[]> = [];
  const secondInvalidations: Array<readonly unknown[]> = [];
  const firstEvents: unknown[] = [];
  const secondEvents: unknown[] = [];
  const firstErrors: unknown[] = [];
  const secondErrors: unknown[] = [];
  let failSnapshot = false;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => [
      failSnapshot
        ? {...SECOND_PROPERTY, code: -704220043}
        : {...SECOND_PROPERTY, value: 2, code: 0},
    ],
    async () => true,
    () => undefined,
  );
  const firstSubscription = await channel.subscribe(
    {
      snapshotProperties: [SECOND_PROPERTY],
      notifications: [FIRST_EVENT],
      refreshSnapshotOnEvents: [FIRST_EVENT.data],
    },
    {
      onStateChanged: state => {
        firstStates.push(state);
      },
      onSnapshotInvalidated: properties => {
        firstInvalidations.push(properties);
      },
      onEventOccurred: event => {
        firstEvents.push(event);
      },
      onError: error => {
        firstErrors.push(error);
      },
    },
  );
  const secondSubscription = await channel.subscribe(
    {
      snapshotProperties: [SECOND_PROPERTY],
      notifications: [FIRST_EVENT],
      refreshSnapshotOnEvents: [FIRST_EVENT.data],
    },
    {
      onStateChanged: state => {
        secondStates.push(state);
      },
      onSnapshotInvalidated: properties => {
        secondInvalidations.push(properties);
      },
      onEventOccurred: event => {
        secondEvents.push(event);
      },
      onError: error => {
        secondErrors.push(error);
      },
    },
  );

  failSnapshot = true;
  source.send({
    type: 'event',
    data: {
      ...FIRST_EVENT.data,
      arguments: {type: 'identified', data: []},
    },
  });
  await waitFor(
    () =>
      firstStates.length === 2 &&
      secondStates.length === 2 &&
      firstEvents.length === 1 &&
      secondEvents.length === 1,
  );

  expect(firstStates.at(-1)).toMatchObject({
    online: true,
    properties: [],
    invalidatedProperties: [SECOND_PROPERTY],
  });
  expect(firstInvalidations).toEqual([]);
  expect(firstErrors).toEqual([]);
  expect(secondStates.at(-1)).toMatchObject({
    online: true,
    properties: [],
    invalidatedProperties: [SECOND_PROPERTY],
  });
  expect(secondInvalidations).toEqual([]);
  expect(secondErrors).toEqual([]);

  await firstSubscription.dispose();
  await secondSubscription.dispose();
});

test('restores event snapshot availability from a replayed property change', async () => {
  const firstFailedSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const secondFailedSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const firstError = new Error('First event snapshot failed.');
  const secondError = new Error('Second event snapshot failed.');
  const source = createMessageSource();
  const states: CloudDeviceState[] = [];
  const invalidations: Array<readonly unknown[]> = [];
  const events: unknown[] = [];
  const updates: CloudPropertyUpdate[] = [];
  const errors: unknown[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount === 1) {
        return [{...FIRST_PROPERTY, value: false, code: 0}];
      } else if (readCount === 2) {
        return firstFailedSnapshot.promise;
      }

      return secondFailedSnapshot.promise;
    },
    async () => true,
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [FIRST_PROPERTY_CHANGE, FIRST_EVENT],
      refreshSnapshotOnEvents: [FIRST_EVENT.data],
      replaySnapshotPropertyNotifications: [FIRST_PROPERTY],
    },
    {
      onStateChanged: state => {
        states.push(state);
      },
      onSnapshotInvalidated: properties => {
        invalidations.push(properties);
      },
      onEventOccurred: event => {
        events.push(event);
      },
      onPropertyChanged: update => {
        updates.push(update);
      },
      onError: error => {
        errors.push(error);
      },
    },
  );
  const sendEvent = (): void => {
    source.send({
      type: 'event',
      data: {
        ...FIRST_EVENT.data,
        arguments: {type: 'identified', data: []},
      },
    });
  };

  sendEvent();
  await waitFor(() => readCount === 2);
  source.send({
    type: 'property-change',
    data: {...FIRST_PROPERTY, value: true},
  });
  firstFailedSnapshot.reject(firstError);
  await waitFor(
    () => errors.length === 1 && events.length === 1 && updates.length === 1,
  );

  expect(states.at(-1)).toMatchObject({
    online: true,
    properties: [],
    invalidatedProperties: [FIRST_PROPERTY],
  });
  expect(invalidations).toEqual([]);
  expect(errors).toEqual([firstError]);

  sendEvent();
  await waitFor(() => readCount === 3);
  secondFailedSnapshot.reject(secondError);
  await waitFor(() => errors.length === 2 && events.length === 2);

  expect(states.at(-1)).toMatchObject({
    online: true,
    properties: [],
    invalidatedProperties: [FIRST_PROPERTY],
  });
  expect(invalidations).toEqual([]);
  expect(errors).toEqual([firstError, secondError]);

  await subscription.dispose();
});

test('invalidates a failed event snapshot before delivering the event and can retry', async () => {
  const failedSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const retrySnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const refreshError = new Error('Event snapshot failed.');
  const source = createMessageSource();
  const order: string[] = [];
  const invalidations: Array<readonly unknown[]> = [];
  const errors: unknown[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount === 1) {
        return [{...FIRST_PROPERTY, value: false, code: 0}];
      } else if (readCount === 2) {
        return failedSnapshot.promise;
      }

      return retrySnapshot.promise;
    },
    async () => true,
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [FIRST_EVENT],
      refreshSnapshotOnEvents: [FIRST_EVENT.data],
    },
    {
      onStateChanged: state => {
        order.push(`state:${String(state.properties[0]?.value)}`);
      },
      onSnapshotInvalidated: properties => {
        invalidations.push(properties);
        order.push('invalidate');
      },
      onEventOccurred: () => {
        order.push('event');
      },
      onError: error => {
        errors.push(error);
        order.push('error');
      },
    },
  );
  const sendEvent = (): void => {
    source.send({
      type: 'event',
      data: {
        ...FIRST_EVENT.data,
        arguments: {type: 'identified', data: []},
      },
    });
  };

  sendEvent();
  await waitFor(() => readCount === 2);
  failedSnapshot.reject(refreshError);
  await waitFor(() => errors.length === 1);

  expect(invalidations).toEqual([]);
  expect(errors).toEqual([refreshError]);
  expect(order).toEqual(['state:false', 'state:undefined', 'event', 'error']);

  sendEvent();
  await waitFor(() => readCount === 3);
  retrySnapshot.resolve([{...FIRST_PROPERTY, value: true, code: 0}]);
  await waitFor(() => order.length === 6);

  expect(order).toEqual([
    'state:false',
    'state:undefined',
    'event',
    'error',
    'state:true',
    'event',
  ]);
  expect(invalidations).toHaveLength(0);
  expect(errors).toHaveLength(1);

  await subscription.dispose();
});

test('invalidates an event snapshot when a replacing manual refresh fails', async () => {
  const eventSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const replacementSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const replacementError = new Error('Manual replacement failed.');
  const source = createMessageSource();
  const order: string[] = [];
  const listenerErrors: unknown[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount === 1) {
        return [{...FIRST_PROPERTY, value: false, code: 0}];
      } else if (readCount === 2) {
        return eventSnapshot.promise;
      }

      return replacementSnapshot.promise;
    },
    async () => true,
    () => undefined,
  );
  const subscription = await channel.subscribe(
    {
      snapshotProperties: [FIRST_PROPERTY],
      notifications: [FIRST_EVENT],
      refreshSnapshotOnEvents: [FIRST_EVENT.data],
    },
    {
      onStateChanged: state => {
        if (state.invalidatedProperties !== undefined) {
          order.push('invalidate');
        }
      },
      onEventOccurred: () => {
        order.push('event');
      },
      onError: error => {
        listenerErrors.push(error);
        order.push('error');
      },
    },
  );

  source.send({
    type: 'event',
    data: {
      ...FIRST_EVENT.data,
      arguments: {type: 'identified', data: []},
    },
  });
  await waitFor(() => readCount === 2);

  const replacement = subscription.refresh();

  await waitFor(() => readCount === 3);
  replacementSnapshot.reject(replacementError);
  await expect(replacement).resolves.toBeUndefined();

  expect(order).toEqual(['invalidate', 'event', 'error']);
  expect(listenerErrors).toEqual([replacementError]);

  eventSnapshot.resolve([{...FIRST_PROPERTY, value: true, code: 0}]);
  await Promise.resolve();
  expect(order).toHaveLength(3);

  await subscription.dispose();
});

test.each(['reconnect', 'online-state'] as const)(
  'invalidates an event snapshot when a replacing %s refresh fails',
  async replacementType => {
    const eventSnapshot = deferred<readonly CloudPropertySnapshot[]>();
    const replacementSnapshot = deferred<readonly CloudPropertySnapshot[]>();
    const replacementError = new Error(`${replacementType} failed.`);
    const source = createMessageSource();
    const order: string[] = [];
    const errors: unknown[] = [];
    let readCount = 0;
    const channel = new CloudDeviceChannel(
      DID,
      source,
      async () => {
        readCount++;

        if (readCount === 1) {
          return [{...FIRST_PROPERTY, value: false, code: 0}];
        } else if (readCount === 2) {
          return eventSnapshot.promise;
        }

        return replacementSnapshot.promise;
      },
      async () => true,
      () => undefined,
    );
    const subscription = await channel.subscribe(
      {
        snapshotProperties: [FIRST_PROPERTY],
        notifications: [FIRST_EVENT],
        refreshSnapshotOnEvents: [FIRST_EVENT.data],
      },
      {
        onStateChanged: state => {
          if (state.invalidatedProperties !== undefined) {
            order.push('invalidate');
          }
        },
        onEventOccurred: () => {
          order.push('event');
        },
        onError: error => {
          errors.push(error);
          order.push('error');
        },
      },
    );

    if (replacementType === 'reconnect') {
      channel.handleConnectionState(false);
    }

    source.send({
      type: 'event',
      data: {
        ...FIRST_EVENT.data,
        arguments: {type: 'identified', data: []},
      },
    });
    await waitFor(() => readCount === 2);

    if (replacementType === 'reconnect') {
      channel.handleConnectionState(true);
    } else {
      source.send({type: 'state', data: {did: DID, online: true}});
    }

    await waitFor(() => readCount === 3);
    replacementSnapshot.reject(replacementError);
    await waitFor(() => errors.length === 1);

    expect(order).toEqual(['invalidate', 'event', 'error']);
    expect(errors).toEqual([replacementError]);

    eventSnapshot.resolve([{...FIRST_PROPERTY, value: true, code: 0}]);
    await Promise.resolve();
    expect(order).toHaveLength(3);

    await subscription.dispose();
  },
);

test('replaces an event snapshot refresh while retaining events in order', async () => {
  const olderSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const newerSnapshot = deferred<readonly CloudPropertySnapshot[]>();
  const source = createMessageSource();
  const order: string[] = [];
  let readCount = 0;
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => {
      readCount++;

      if (readCount === 1) {
        return [{...FIRST_PROPERTY, value: 0, code: 0}];
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
      notifications: [FIRST_EVENT],
      refreshSnapshotOnEvents: [FIRST_EVENT.data],
    },
    {
      onStateChanged: state => {
        order.push(`state:${String(state.properties[0]?.value)}`);
      },
      onSnapshotInvalidated: () => {
        order.push('invalidate');
      },
      onEventOccurred: event => {
        const value =
          event.arguments.type === 'identified'
            ? event.arguments.data[0]?.value
            : event.arguments.data[0];
        order.push(`event:${String(value)}`);
      },
    },
  );
  const sendEvent = (value: string): void => {
    source.send({
      type: 'event',
      data: {
        ...FIRST_EVENT.data,
        arguments: {
          type: 'identified',
          data: [{piid: 1, value}],
        },
      },
    });
  };

  sendEvent('first');
  await waitFor(() => readCount === 2);
  sendEvent('second');
  await waitFor(() => readCount === 3);

  newerSnapshot.resolve([{...FIRST_PROPERTY, value: 2, code: 0}]);
  await waitFor(() => order.length === 4);

  expect(order).toEqual(['state:0', 'state:2', 'event:first', 'event:second']);

  olderSnapshot.resolve([{...FIRST_PROPERTY, value: 1, code: 0}]);
  await Promise.resolve();
  expect(order).toHaveLength(4);

  await subscription.dispose();
});

test('rejects invalid event-triggered snapshot refresh requests', async () => {
  const source = createMessageSource();
  const channel = new CloudDeviceChannel(
    DID,
    source,
    async () => [{...FIRST_PROPERTY, value: true, code: 0}],
    async () => true,
    () => undefined,
  );

  await expect(
    channel.subscribe(
      {
        snapshotProperties: [],
        notifications: [FIRST_EVENT],
        refreshSnapshotOnEvents: [FIRST_EVENT.data],
      },
      {},
    ),
  ).rejects.toThrow('cannot refresh an empty snapshot on events');

  await expect(
    channel.subscribe(
      {
        snapshotProperties: [FIRST_PROPERTY],
        refreshSnapshotOnEvents: [FIRST_EVENT.data],
      },
      {},
    ),
  ).rejects.toThrow('can only refresh snapshots for subscribed events');

  expect(source.subscribeCount).toBe(0);
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
