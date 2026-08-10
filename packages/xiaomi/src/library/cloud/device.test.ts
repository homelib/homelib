import {CloudDeviceChannel, type CloudDeviceMessageSource} from './device.js';
import type {CloudMqttDeviceMessageHandler} from './mqtt.js';

test('keeps an MQTT update that arrives during the initial snapshot', async () => {
  const snapshot = deferred<
    readonly {
      readonly did: string;
      readonly siid: number;
      readonly piid: number;
      readonly value: unknown;
      readonly code: number;
    }[]
  >();
  let messageHandler: CloudMqttDeviceMessageHandler | undefined;
  let empty = false;
  let subscribeCount = 0;
  let unsubscribeCount = 0;
  const messageSource: CloudDeviceMessageSource = {
    subscribeDevice: async (_did, handler) => {
      subscribeCount++;
      messageHandler = handler;
    },
    unsubscribeDevice: async _did => {
      unsubscribeCount++;
    },
  };
  let readCount = 0;
  const readProperties = async (): Promise<
    readonly {
      readonly did: string;
      readonly siid: number;
      readonly piid: number;
      readonly value: unknown;
      readonly code: number;
    }[]
  > => {
    readCount++;
    return snapshot.promise;
  };
  const channel = new CloudDeviceChannel(
    'device-1',
    messageSource,
    readProperties,
    () => {
      empty = true;
    },
  );
  const updates: unknown[] = [];
  const property = {did: 'device-1', siid: 2, piid: 1};
  const subscriptionPromise = channel.subscribe([property], {
    onPropertyChanged: update => {
      updates.push(update);
    },
  });

  await waitFor(() => readCount > 0);

  const handler = messageHandler;

  if (handler === undefined) {
    throw new Error('Cloud MQTT handler was not registered.');
  }

  handler({...property, type: 'property', value: true});
  snapshot.resolve([{...property, value: false, code: 0}]);

  const subscription = await subscriptionPromise;

  expect(updates).toEqual([
    {...property, value: true, revision: 1, source: 'mqtt'},
  ]);

  const replayedUpdates: unknown[] = [];
  const secondSubscription = await channel.subscribe([property], {
    onPropertyChanged: update => {
      replayedUpdates.push(update);
    },
  });

  expect(subscribeCount).toBe(1);
  expect(readCount).toBe(1);
  expect(replayedUpdates).toEqual(updates);

  await subscription.dispose();
  expect(unsubscribeCount).toBe(0);

  await secondSubscription.dispose();
  expect(unsubscribeCount).toBe(1);
  expect(empty).toBe(true);
});

test('keeps an MQTT update that arrives during a reconnect snapshot', async () => {
  let messageHandler: CloudMqttDeviceMessageHandler | undefined;
  let readCount = 0;
  let reconnectSnapshotResolved = false;
  const reconnectSnapshot = deferred<
    readonly {
      readonly did: string;
      readonly siid: number;
      readonly piid: number;
      readonly value: unknown;
      readonly code: number;
    }[]
  >();
  const property = {did: 'device-1', siid: 2, piid: 1};
  const channel = new CloudDeviceChannel(
    property.did,
    {
      subscribeDevice: async (_did, handler) => {
        messageHandler = handler;
      },
      unsubscribeDevice: async _did => undefined,
    },
    async () => {
      readCount++;

      if (readCount === 1) {
        return [{...property, value: false, code: 0}];
      }

      return reconnectSnapshot.promise.then(results => {
        reconnectSnapshotResolved = true;
        return results;
      });
    },
    () => undefined,
  );
  const updates: unknown[] = [];
  const subscription = await channel.subscribe([property], {
    onPropertyChanged: update => {
      updates.push(update);
    },
  });

  channel.handleConnectionState(false);
  channel.handleConnectionState(true);
  await waitFor(() => readCount === 2);

  const handler = messageHandler;

  if (handler === undefined) {
    throw new Error('Cloud MQTT handler was not registered.');
  }

  handler({...property, type: 'property', value: true});
  reconnectSnapshot.resolve([{...property, value: false, code: 0}]);
  await waitFor(() => reconnectSnapshotResolved);

  expect(updates).toEqual([
    {...property, value: false, revision: 1, source: 'snapshot'},
    {...property, value: true, revision: 2, source: 'mqtt'},
  ]);

  await subscription.dispose();
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
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

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (condition()) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error('Expected condition was not reached.');
}
