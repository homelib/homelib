import {EventEmitter} from 'node:events';

import type {IClientOptions, MqttClient} from 'mqtt';

import {
  CLOUD_MQTT_RECONNECT_INTERVAL,
  CLOUD_MQTT_SUBSCRIPTION_BATCH_INTERVAL,
} from '../../cloud/constants.js';
import {
  CloudMqttClient,
  type CloudMqttDeviceMessage,
} from '../../cloud/mqtt.js';

test('subscribes once per device and routes cloud messages', async () => {
  const mqttClient = new TestMqttClient();
  let connection:
    {readonly url: string; readonly options: IClientOptions} | undefined;
  const client = new CloudMqttClient(
    {
      uuid: 'test-uuid',
      accessToken: 'test-access-token',
      cloudServer: 'cn',
    },
    async (url, options) => {
      connection = {url, options};
      mqttClient.options = options;
      return mqttClient as unknown as MqttClient;
    },
  );
  const messages: CloudMqttDeviceMessage[] = [];
  const connectionStates: boolean[] = [];
  const handler = (message: CloudMqttDeviceMessage): void => {
    messages.push(message);
  };
  client.addConnectionStateListener(connected => {
    connectionStates.push(connected);
  });

  await client.subscribeDevice('device-1', handler);
  await client.subscribeDevice('device-1', handler);

  expect(connection).toEqual(
    expect.objectContaining({
      url: 'mqtts://cn-ha.mqtt.io.mi.com:8883',
      options: expect.objectContaining({
        clientId: 'ha.test-uuid',
        username: '2882303761520251711',
        password: 'test-access-token',
        protocolVersion: 5,
      }),
    }),
  );
  expect(connection?.options).not.toHaveProperty('rejectUnauthorized');
  expect(mqttClient.subscribeCalls).toEqual([
    {
      topics: [
        'device/device-1/up/properties_changed/#',
        'device/device-1/up/event_occured/#',
        'device/device-1/state/#',
      ],
      options: {qos: 2},
    },
  ]);

  mqttClient.emit(
    'message',
    'device/device-1/up/properties_changed/2/1',
    Buffer.from(JSON.stringify({params: {siid: 2, piid: 1, value: true}})),
  );
  mqttClient.emit(
    'message',
    'device/device-1/up/event_occured/3/1',
    Buffer.from(
      JSON.stringify({
        params: {
          siid: 3,
          eiid: 1,
          arguments: [{piid: 2, value: 'pressed'}],
        },
      }),
    ),
  );
  mqttClient.emit(
    'message',
    'device/device-1/state/online',
    Buffer.from(JSON.stringify({device_id: 'device-1', event: 'online'})),
  );
  mqttClient.emit(
    'message',
    'device/device-1/state/offline',
    Buffer.from(JSON.stringify({device_id: 'device-1', event: 'offline'})),
  );

  expect(messages).toEqual([
    {
      type: 'property-change',
      data: {did: 'device-1', siid: 2, piid: 1, value: true},
    },
    {
      type: 'event',
      data: {
        did: 'device-1',
        siid: 3,
        eiid: 1,
        arguments: {
          type: 'identified',
          data: [{piid: 2, value: 'pressed'}],
        },
      },
    },
    {type: 'state', data: {did: 'device-1', online: true}},
    {type: 'state', data: {did: 'device-1', online: false}},
  ]);

  mqttClient.connected = false;
  mqttClient.emit('close');
  mqttClient.connected = true;
  mqttClient.emit('connect');
  await waitFor(() => connectionStates.length === 3);

  expect(connectionStates).toEqual([true, false, true]);
  expect(mqttClient.subscribeCalls).toHaveLength(2);

  await client.unsubscribeDevice('device-1');
  expect(mqttClient.unsubscribeCalls).toEqual([
    [
      'device/device-1/up/properties_changed/#',
      'device/device-1/up/event_occured/#',
      'device/device-1/state/#',
    ],
  ]);
  await client.disconnect();
});

test('rejects event arguments without a PIID and value pair', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  const messages: CloudMqttDeviceMessage[] = [];
  const errors: unknown[] = [];
  const originalError = console.error;
  console.error = error => {
    errors.push(error);
  };

  try {
    await client.subscribeDevice('device-1', message => {
      messages.push(message);
    });
    mqttClient.emit(
      'message',
      'device/device-1/up/event_occured/3/1',
      Buffer.from(
        JSON.stringify({
          params: {siid: 3, eiid: 1, arguments: [{piid: 2}]},
        }),
      ),
    );

    expect(messages).toEqual([]);
    expect(errors).toEqual([
      new Error('Cloud MQTT event argument has no value.'),
    ]);
  } finally {
    console.error = originalError;
    await client.disconnect();
  }
});

test('retries device subscriptions once while a reconnected socket stays connected', async () => {
  import.meta.jest.useFakeTimers();

  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  const connectionStates: boolean[] = [];
  const originalError = console.error;
  console.error = () => undefined;

  try {
    client.addConnectionStateListener(connected => {
      connectionStates.push(connected);
    });
    await client.subscribeDevice('device-1', () => undefined);

    mqttClient.connected = false;
    mqttClient.emit('close');
    mqttClient.rejectedSubscriptionCount = 1;
    mqttClient.connected = true;
    mqttClient.emit('connect');
    mqttClient.emit('connect');
    await flushMicrotasks();

    expect(mqttClient.subscribeCalls).toHaveLength(2);
    expect(import.meta.jest.getTimerCount()).toBe(1);
    expect(connectionStates).toEqual([true, false]);

    await import.meta.jest.advanceTimersByTimeAsync(
      CLOUD_MQTT_RECONNECT_INTERVAL,
    );
    await waitFor(() => connectionStates.length === 3);

    expect(mqttClient.subscribeCalls).toHaveLength(3);
    expect(connectionStates).toEqual([true, false, true]);
    expect(import.meta.jest.getTimerCount()).toBe(0);
  } finally {
    await client.disconnect();
    console.error = originalError;
    import.meta.jest.useRealTimers();
  }
});

test('stops retrying device subscriptions after disconnect', async () => {
  import.meta.jest.useFakeTimers();

  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  const originalError = console.error;
  console.error = () => undefined;

  try {
    await client.subscribeDevice('device-1', () => undefined);

    mqttClient.connected = false;
    mqttClient.emit('close');
    mqttClient.rejectedSubscriptionCount = 1;
    mqttClient.connected = true;
    mqttClient.emit('connect');
    await flushMicrotasks();

    expect(mqttClient.subscribeCalls).toHaveLength(2);
    expect(import.meta.jest.getTimerCount()).toBe(1);

    await client.disconnect();

    expect(import.meta.jest.getTimerCount()).toBe(0);
    await import.meta.jest.advanceTimersByTimeAsync(
      CLOUD_MQTT_RECONNECT_INTERVAL,
    );
    expect(mqttClient.subscribeCalls).toHaveLength(2);
  } finally {
    await client.disconnect();
    console.error = originalError;
    import.meta.jest.useRealTimers();
  }
});

test('ignores an obsolete batched subscription after a rapid reconnect', async () => {
  import.meta.jest.useFakeTimers();

  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  const connectionStates: boolean[] = [];

  try {
    client.addConnectionStateListener(connected => {
      connectionStates.push(connected);
    });

    for (let index = 1; index <= 101; index++) {
      await client.subscribeDevice(`device-${index}`, () => undefined);
    }

    mqttClient.subscribeCalls.length = 0;
    mqttClient.connected = false;
    mqttClient.emit('close');
    mqttClient.connected = true;
    mqttClient.emit('connect');
    await flushMicrotasks();

    expect(mqttClient.subscribeCalls).toHaveLength(1);
    expect(mqttClient.subscribeCalls[0]?.topics).toHaveLength(300);
    expect(connectionStates).toEqual([true, false]);

    mqttClient.connected = false;
    mqttClient.emit('close');
    mqttClient.connected = true;
    mqttClient.emit('connect');
    await flushMicrotasks();

    expect(mqttClient.subscribeCalls).toHaveLength(2);
    expect(mqttClient.subscribeCalls[1]?.topics).toHaveLength(300);
    expect(connectionStates).toEqual([true, false]);

    await import.meta.jest.advanceTimersByTimeAsync(
      CLOUD_MQTT_SUBSCRIPTION_BATCH_INTERVAL,
    );
    await waitFor(() => connectionStates.length === 3);

    expect(mqttClient.subscribeCalls).toHaveLength(3);
    expect(mqttClient.subscribeCalls[2]?.topics).toHaveLength(3);
    expect(connectionStates).toEqual([true, false, true]);
  } finally {
    await client.disconnect();
    import.meta.jest.useRealTimers();
  }
});

test('waits for the current session when a single-device subscription resolves late', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);

  try {
    await client.subscribeDevice('device-1', () => undefined);

    const obsoleteSubscription = mqttClient.deferNextSubscription();
    let subscriptionSettled = false;
    const subscription = client
      .subscribeDevice('device-2', () => undefined)
      .finally(() => {
        subscriptionSettled = true;
      });
    await waitFor(() => mqttClient.subscribeCalls.length === 2);

    const currentSubscription = mqttClient.deferNextSubscription();
    mqttClient.connected = false;
    mqttClient.emit('close');
    mqttClient.connected = true;
    mqttClient.emit('connect');
    await waitFor(() => mqttClient.subscribeCalls.length === 3);

    obsoleteSubscription.resolve();
    await flushMicrotasks();
    expect(subscriptionSettled).toBe(false);

    currentSubscription.resolve();
    await subscription;
    expect(subscriptionSettled).toBe(true);
  } finally {
    await client.disconnect();
  }
});

test('does not reconnect a pending subscription after an explicit disconnect', async () => {
  const firstMqttClient = new TestMqttClient();
  const secondMqttClient = new TestMqttClient();
  const mqttClients = [firstMqttClient, secondMqttClient];
  let connectionCount = 0;
  const client = new CloudMqttClient(
    {
      uuid: 'test-uuid',
      accessToken: 'test-access-token',
      cloudServer: 'cn',
    },
    async (_url, options) => {
      const mqttClient = mqttClients[connectionCount++];

      if (mqttClient === undefined) {
        throw new Error('Unexpected MQTT connection.');
      }

      mqttClient.options = options;
      return mqttClient as unknown as MqttClient;
    },
  );
  const handler = (): void => undefined;

  try {
    await client.subscribeDevice('device-1', handler);

    const pendingSubscription = firstMqttClient.deferNextSubscription();
    const subscription = client.subscribeDevice('device-2', handler);
    await waitFor(() => firstMqttClient.subscribeCalls.length === 2);

    await client.disconnect();
    pendingSubscription.resolve();

    await expect(subscription).rejects.toThrow(
      'Cloud MQTT disconnected while subscribing.',
    );
    expect(connectionCount).toBe(1);
    expect(secondMqttClient.subscribeCalls).toHaveLength(0);

    await client.subscribeDevice('device-2', handler);
    expect(connectionCount).toBe(2);
  } finally {
    await client.disconnect();
  }
});

function createClient(mqttClient: TestMqttClient): CloudMqttClient {
  return new CloudMqttClient(
    {
      uuid: 'test-uuid',
      accessToken: 'test-access-token',
      cloudServer: 'cn',
    },
    async (_url, options) => {
      mqttClient.options = options;
      return mqttClient as unknown as MqttClient;
    },
  );
}

class TestMqttClient extends EventEmitter {
  connected = true;

  options: IClientOptions = {};

  readonly subscribeCalls: Array<{
    readonly topics: readonly string[];
    readonly options: unknown;
  }> = [];

  readonly unsubscribeCalls: string[][] = [];

  rejectedSubscriptionCount = 0;

  private readonly deferredSubscriptionQueue: Array<Deferred<void>> = [];

  deferNextSubscription(): Deferred<void> {
    const deferred = createDeferred<void>();
    this.deferredSubscriptionQueue.push(deferred);
    return deferred;
  }

  async subscribeAsync(
    topics: string[],
    options: unknown,
  ): Promise<Array<{readonly topic: string; readonly qos: 2}>> {
    this.subscribeCalls.push({topics, options});

    if (this.rejectedSubscriptionCount > 0) {
      this.rejectedSubscriptionCount--;
      throw new Error('Test MQTT subscription failed.');
    }

    await this.deferredSubscriptionQueue.shift()?.promise;

    return topics.map(topic => ({topic, qos: 2}));
  }

  async unsubscribeAsync(topics: string[]): Promise<void> {
    this.unsubscribeCalls.push(topics);
  }

  async endAsync(): Promise<void> {
    this.connected = false;
    this.emit('close');
  }
}

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });

  return {promise, resolve};
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
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
