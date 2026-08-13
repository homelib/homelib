import {EventEmitter} from 'node:events';

import type {IClientOptions, MqttClient} from 'mqtt';

import {MiotEndpointConnectionTransportUnavailableError} from '../endpoint-connection.js';
import {MiotSetPropertyRequest} from '../miot/index.js';

import {decodeMipsMessage, encodeMipsMessage} from './message.js';
import {
  LocalMqttClient,
  LocalMqttProtocolError,
  LocalMqttRequestInterruptedError,
  LocalMqttRequestTimeoutError,
} from './mqtt.js';

test('connects with MQTT 5, QoS 2, and verified mutual TLS', async () => {
  const mqttClient = new TestMqttClient();
  let connection:
    {readonly url: string; readonly options: IClientOptions} | undefined;
  const client = createClient(mqttClient, (url, options) => {
    connection = {url, options};
  });
  const states: boolean[] = [];
  client.addConnectionStateListener(connected => {
    states.push(connected);
  });

  await client.connect();

  expect(connection).toEqual({
    url: 'mqtts://192.0.2.10:8883',
    options: expect.objectContaining({
      clientId: 'virtual-did',
      protocolVersion: 5,
      clean: true,
      rejectUnauthorized: true,
      ca: 'test-ca',
      cert: 'test-cert',
      key: 'test-key',
      resubscribe: false,
    }),
  });
  expect(
    (
      connection?.options as IClientOptions & {
        checkServerIdentity?: unknown;
      }
    ).checkServerIdentity,
  ).toEqual(expect.any(Function));
  expect(mqttClient.subscribeCalls).toEqual([
    {
      topics: ['virtual-did/#', 'master/appMsg/devListChange'],
      options: {qos: 2},
    },
  ]);
  expect(client.connected).toBe(true);
  expect(states).toEqual([true]);

  await client.disconnect();
  expect(states).toEqual([true, false]);
});

test('reads and validates the gateway device list', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  await client.connect();

  const listPromise = client.getDeviceList();
  await waitFor(() => mqttClient.publishCalls.length === 1);
  expect(readPublishedRequest(mqttClient, 0)).toEqual({
    topic: 'master/proxy/getDevList',
    from: 'local',
    returnTopic: 'virtual-did/reply',
    body: {},
  });
  mqttClient.reply(0, {
    devList: {
      'device-1': {
        online: true,
        specV2Access: true,
        pushAvailable: false,
      },
      'device-2': {},
    },
  });

  await expect(listPromise).resolves.toEqual(
    new Map([
      ['device-1', {online: true, specV2Access: true, pushAvailable: false}],
      ['device-2', {online: false, specV2Access: false, pushAvailable: false}],
    ]),
  );
  await client.disconnect();
});

test('reads properties sequentially and preserves input order', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  await client.connect();
  const properties = [
    {did: 'device-1', siid: 2, piid: 2},
    {did: 'device-1', siid: 2, piid: 1},
  ];

  const readPromise = client.getProperties(properties);
  await waitFor(() => mqttClient.publishCalls.length === 1);
  expect(readPublishedRequest(mqttClient, 0).body).toEqual(properties[0]);
  mqttClient.reply(0, {value: 55});
  await waitFor(() => mqttClient.publishCalls.length === 2);
  expect(readPublishedRequest(mqttClient, 1).body).toEqual(properties[1]);
  mqttClient.reply(1, {value: false});

  await expect(readPromise).resolves.toEqual([
    {...properties[0], code: 0, value: 55},
    {...properties[1], code: 0, value: false},
  ]);
  await client.disconnect();
});

test('serializes property reads across concurrent callers', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  await client.connect();
  const firstProperty = {did: 'device-1', siid: 2, piid: 1};
  const secondProperty = {did: 'device-2', siid: 3, piid: 2};

  const firstRead = client.getProperties([firstProperty]);
  const secondRead = client.getProperties([secondProperty]);
  await waitFor(() => mqttClient.publishCalls.length === 1);
  expect(readPublishedRequest(mqttClient, 0).body).toEqual(firstProperty);
  await flushMicrotasks();
  expect(mqttClient.publishCalls).toHaveLength(1);

  mqttClient.reply(0, {value: true});
  await waitFor(() => mqttClient.publishCalls.length === 2);
  expect(readPublishedRequest(mqttClient, 1).body).toEqual(secondProperty);
  mqttClient.reply(1, {value: 22.5});

  await expect(firstRead).resolves.toEqual([
    {...firstProperty, code: 0, value: true},
  ]);
  await expect(secondRead).resolves.toEqual([
    {...secondProperty, code: 0, value: 22.5},
  ]);
  await client.disconnect();
});

test('executes a set-property request through proxy/rpcReq', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  await client.connect();
  const request = new MiotSetPropertyRequest(
    {did: 'device-1', siid: 2, piid: 1},
    true,
  );

  const resultPromise = client.executeRequest(request);
  await waitFor(() => mqttClient.publishCalls.length === 1);
  const published = readPublishedRequest(mqttClient, 0);
  expect(published.topic).toBe('master/proxy/rpcReq');
  expect(published.body).toEqual({
    did: 'device-1',
    rpc: {
      id: expect.any(Number),
      method: 'set_properties',
      params: [{did: 'device-1', siid: 2, piid: 1, value: true}],
    },
  });
  mqttClient.reply(0, {
    result: [{did: 'device-1', siid: 2, piid: 1, code: 0}],
  });

  await expect(resultPromise).resolves.toEqual({code: 0});
  await client.disconnect();
});

test('aggregates property listeners for the same device', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  await client.connect();
  const firstUpdates: unknown[] = [];
  const secondUpdates: unknown[] = [];
  const first = await client.subscribeProperties('device-1', update => {
    firstUpdates.push(update);
  });
  const second = await client.subscribeProperties('device-1', update => {
    secondUpdates.push(update);
  });

  expect(mqttClient.subscribeCalls).toHaveLength(2);
  expect(mqttClient.subscribeCalls[1]).toEqual({
    topics: ['master/appMsg/notify/iot/device-1/property/#'],
    options: {qos: 2},
  });
  mqttClient.notifyProperty({
    did: 'device-1',
    siid: 2,
    piid: 1,
    value: true,
  });
  expect(firstUpdates).toEqual([
    {did: 'device-1', siid: 2, piid: 1, value: true},
  ]);
  expect(secondUpdates).toEqual(firstUpdates);

  await first.dispose();
  expect(mqttClient.unsubscribeCalls).toHaveLength(0);
  await second.dispose();
  expect(mqttClient.unsubscribeCalls).toEqual([
    'master/appMsg/notify/iot/device-1/property/#',
  ]);
  await client.disconnect();
});

test('normalizes decimal string identifiers in local notifications', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  await client.connect();
  const properties: unknown[] = [];
  const events: unknown[] = [];
  const propertySubscription = await client.subscribeProperties(
    'device-1',
    update => {
      properties.push(update);
    },
  );
  const eventSubscription = await client.subscribeEvents('device-1', event => {
    events.push(event);
  });

  mqttClient.notifyProperty({
    did: 'device-1',
    siid: '2',
    piid: 1,
    value: true,
  });
  mqttClient.notifyEvent({
    did: 'device-1',
    siid: 3,
    eiid: '1',
    arguments: [42],
  });

  expect(properties).toEqual([
    {did: 'device-1', siid: 2, piid: 1, value: true},
  ]);
  expect(events).toEqual([
    {did: 'device-1', siid: 3, eiid: 1, arguments: [42]},
  ]);

  await propertySubscription.dispose();
  await eventSubscription.dispose();
  await client.disconnect();
});

test('uses topic identifiers omitted from local notification payloads', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  await client.connect();
  const properties: unknown[] = [];
  const events: unknown[] = [];
  const propertySubscription = await client.subscribeProperties(
    'device-1',
    update => {
      properties.push(update);
    },
  );
  const eventSubscription = await client.subscribeEvents('device-1', event => {
    events.push(event);
  });

  mqttClient.notifyProperty({did: 'device-1', value: false}, '2.1');
  mqttClient.notifyEvent({did: 'device-1', arguments: ['pressed']}, '3.1');

  expect(properties).toEqual([
    {did: 'device-1', siid: 2, piid: 1, value: false},
  ]);
  expect(events).toEqual([
    {did: 'device-1', siid: 3, eiid: 1, arguments: ['pressed']},
  ]);

  await propertySubscription.dispose();
  await eventSubscription.dispose();
  await client.disconnect();
});

test('uses payload identifiers when local notification topics omit them', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  await client.connect();
  const properties: unknown[] = [];
  const events: unknown[] = [];
  const propertySubscription = await client.subscribeProperties(
    'device-1',
    update => {
      properties.push(update);
    },
  );
  const eventSubscription = await client.subscribeEvents('device-1', event => {
    events.push(event);
  });

  mqttClient.notifyProperty(
    {did: 'device-1', siid: 2, piid: 1, value: false},
    'unspecified',
  );
  mqttClient.notifyEvent(
    {did: 'device-1', siid: '3', eiid: '1', arguments: ['pressed']},
    'unspecified',
  );

  expect(properties).toEqual([
    {did: 'device-1', siid: 2, piid: 1, value: false},
  ]);
  expect(events).toEqual([
    {did: 'device-1', siid: 3, eiid: 1, arguments: ['pressed']},
  ]);

  await propertySubscription.dispose();
  await eventSubscription.dispose();
  await client.disconnect();
});

test('ignores unrouteable and rejects inconsistent local notifications', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  const errors: unknown[] = [];
  const originalError = console.error;
  console.error = error => {
    errors.push(error);
  };
  let subscription: {dispose(): Promise<void>} | undefined;

  try {
    await client.connect();
    const updates: unknown[] = [];
    subscription = await client.subscribeProperties('device-1', update => {
      updates.push(update);
    });

    mqttClient.notifyProperty(
      {did: 'device-1', siid: 3, piid: 1, value: true},
      '2.1',
    );
    mqttClient.notifyProperty({did: 'device-1', value: true}, '02.1');
    mqttClient.notifyProperty(
      {did: 'device-1', siid: 'invalid', piid: 1, value: true},
      '2.1',
    );
    mqttClient.notifyProperty(
      {did: 'device-1', siid: 2, value: true},
      'unspecified',
    );
    mqttClient.notifyEvent({did: 'device-1', siid: 3, eiid: 2}, '3.1');
    mqttClient.notifyEvent({did: 'device-1'}, 'undefined.undefined');

    expect(updates).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBeInstanceOf(LocalMqttProtocolError);
    expect(errors[1]).toBeInstanceOf(LocalMqttProtocolError);
  } finally {
    await subscription?.dispose();
    await client.disconnect();
    console.error = originalError;
  }
});

test('subscribes to and validates local device events', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  await client.connect();
  const events: unknown[] = [];
  const subscription = await client.subscribeEvents('device-1', event => {
    events.push(event);
  });

  expect(mqttClient.subscribeCalls.at(-1)).toEqual({
    topics: ['master/appMsg/notify/iot/device-1/event/#'],
    options: {qos: 2},
  });
  mqttClient.notifyEvent({
    did: 'device-1',
    siid: 3,
    eiid: 1,
    arguments: [42, 'open'],
  });
  expect(events).toEqual([
    {did: 'device-1', siid: 3, eiid: 1, arguments: [42, 'open']},
  ]);

  await subscription.dispose();
  expect(mqttClient.unsubscribeCalls.at(-1)).toBe(
    'master/appMsg/notify/iot/device-1/event/#',
  );
  await client.disconnect();
});

test('routes device-list changes received under the virtual DID', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  const changes: Array<readonly string[]> = [];
  const removeListener = client.addDeviceListChangedListener(dids => {
    changes.push(dids);
  });
  await client.connect();

  mqttClient.notifyDeviceListChanged(['device-1', 'device-2']);
  expect(changes).toEqual([['device-1', 'device-2']]);

  removeListener();
  mqttClient.notifyDeviceListChanged(['device-3']);
  expect(changes).toHaveLength(1);
  await client.disconnect();
});

test('rejects pending requests and restores subscriptions on reconnect', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  const states: boolean[] = [];
  client.addConnectionStateListener(connected => {
    states.push(connected);
  });
  await client.connect();
  await client.subscribeProperties('device-1', () => undefined);
  const pendingRequest = client.getDeviceList();
  const rejectedRequest = expect(pendingRequest).rejects.toBeInstanceOf(
    LocalMqttRequestInterruptedError,
  );
  await waitFor(() => mqttClient.publishCalls.length === 1);

  mqttClient.connected = false;
  mqttClient.emit('close');
  await rejectedRequest;
  expect(client.connected).toBe(false);

  mqttClient.connected = true;
  mqttClient.emit('connect');
  await waitFor(() => client.connected);
  expect(mqttClient.subscribeCalls.slice(-2)).toEqual([
    {
      topics: ['virtual-did/#', 'master/appMsg/devListChange'],
      options: {qos: 2},
    },
    {
      topics: ['master/appMsg/notify/iot/device-1/property/#'],
      options: {qos: 2},
    },
  ]);
  expect(states).toEqual([true, false, true]);
  await client.disconnect();
});

test('retries subscription restoration while a reconnected socket stays up', async () => {
  import.meta.jest.useFakeTimers();

  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  const originalError = console.error;
  console.error = () => undefined;

  try {
    await client.connect();
    mqttClient.connected = false;
    mqttClient.emit('close');
    mqttClient.rejectedSubscriptionCount = 1;
    mqttClient.connected = true;
    mqttClient.emit('connect');
    await flushMicrotasks();

    expect(client.connected).toBe(false);
    expect(import.meta.jest.getTimerCount()).toBe(1);
    await import.meta.jest.advanceTimersByTimeAsync(6_000);
    await waitFor(() => client.connected);
    expect(import.meta.jest.getTimerCount()).toBe(0);
  } finally {
    await client.disconnect();
    console.error = originalError;
    import.meta.jest.useRealTimers();
  }
});

test('uses unavailable only before publication and a distinct timeout after it', async () => {
  import.meta.jest.useFakeTimers();

  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  const request = new MiotSetPropertyRequest(
    {did: 'device-1', siid: 2, piid: 1},
    true,
  );

  try {
    await expect(client.executeRequest(request)).rejects.toBeInstanceOf(
      MiotEndpointConnectionTransportUnavailableError,
    );

    await client.connect();
    const command = client.executeRequest(request);
    const rejectedCommand = expect(command).rejects.toBeInstanceOf(
      LocalMqttRequestTimeoutError,
    );
    await waitFor(() => mqttClient.publishCalls.length === 1);
    await import.meta.jest.advanceTimersByTimeAsync(10_000);
    await rejectedCommand;
    await expect(command).rejects.not.toBeInstanceOf(
      MiotEndpointConnectionTransportUnavailableError,
    );
  } finally {
    await client.disconnect();
    import.meta.jest.useRealTimers();
  }
});

test('does not report a publish failure as safely unavailable', async () => {
  const mqttClient = new TestMqttClient();
  const client = createClient(mqttClient);
  const request = new MiotSetPropertyRequest(
    {did: 'device-1', siid: 2, piid: 1},
    true,
  );
  await client.connect();
  mqttClient.publishError = new Error('test publish failure');

  const command = client.executeRequest(request);
  await expect(command).rejects.toBeInstanceOf(
    LocalMqttRequestInterruptedError,
  );
  await expect(command).rejects.not.toBeInstanceOf(
    MiotEndpointConnectionTransportUnavailableError,
  );
  await client.disconnect();
});

function createClient(
  mqttClient: TestMqttClient,
  onConnect?: (url: string, options: IClientOptions) => void,
): LocalMqttClient {
  return new LocalMqttClient({
    virtualDid: 'virtual-did',
    gatewayDid: '123456789',
    host: '192.0.2.10',
    ca: 'test-ca',
    cert: 'test-cert',
    key: 'test-key',
    connector: async (url, options) => {
      onConnect?.(url, options);
      mqttClient.options = options;
      return mqttClient as unknown as MqttClient;
    },
  });
}

function readPublishedRequest(
  mqttClient: TestMqttClient,
  index: number,
): {
  readonly topic: string;
  readonly from: string | undefined;
  readonly returnTopic: string | undefined;
  readonly body: unknown;
} {
  const publication = mqttClient.publishCalls[index];

  if (publication === undefined) {
    throw new Error(`Missing test MQTT publication ${index}.`);
  }

  const message = decodeMipsMessage(publication.payload);
  return {
    topic: publication.topic,
    from: message.from,
    returnTopic: message.returnTopic,
    body: JSON.parse(message.payload ?? ''),
  };
}

class TestMqttClient extends EventEmitter {
  connected = true;

  options: IClientOptions = {};

  readonly subscribeCalls: Array<{
    readonly topics: readonly string[];
    readonly options: unknown;
  }> = [];

  readonly unsubscribeCalls: Array<string | string[]> = [];

  readonly publishCalls: Array<{
    readonly topic: string;
    readonly payload: Buffer;
    readonly options: unknown;
  }> = [];

  publishError: Error | undefined;

  rejectedSubscriptionCount = 0;

  async subscribeAsync(
    topics: string[],
    options: unknown,
  ): Promise<Array<{readonly topic: string; readonly qos: 2}>> {
    this.subscribeCalls.push({topics, options});

    if (this.rejectedSubscriptionCount > 0) {
      this.rejectedSubscriptionCount--;
      throw new Error('Test MQTT subscription failed.');
    }

    return topics.map(topic => ({topic, qos: 2}));
  }

  async unsubscribeAsync(topics: string | string[]): Promise<void> {
    this.unsubscribeCalls.push(topics);
  }

  async publishAsync(
    topic: string,
    payload: Buffer,
    options: unknown,
  ): Promise<void> {
    this.publishCalls.push({topic, payload, options});

    if (this.publishError !== undefined) {
      throw this.publishError;
    }
  }

  async endAsync(): Promise<void> {
    this.connected = false;
    this.emit('close');
  }

  reply(index: number, body: unknown): void {
    const publication = this.publishCalls[index];

    if (publication === undefined) {
      throw new Error(`Missing test MQTT publication ${index}.`);
    }

    const request = decodeMipsMessage(publication.payload);
    this.emit(
      'message',
      'virtual-did/reply',
      encodeMipsMessage({
        id: request.id,
        payload: JSON.stringify(body),
      }),
    );
  }

  notifyProperty(
    update: {
      readonly did: string;
      readonly siid?: number | string;
      readonly piid?: number | string;
      readonly value: unknown;
    },
    instance = `${update.siid}.${update.piid}`,
  ): void {
    this.emit(
      'message',
      `virtual-did/appMsg/notify/iot/${update.did}/property/${instance}`,
      encodeMipsMessage({id: 1, payload: JSON.stringify(update)}),
    );
  }

  notifyEvent(
    update: {
      readonly did: string;
      readonly siid?: number | string;
      readonly eiid?: number | string;
      readonly arguments?: readonly unknown[];
    },
    instance = `${update.siid}.${update.eiid}`,
  ): void {
    this.emit(
      'message',
      `virtual-did/appMsg/notify/iot/${update.did}/event/${instance}`,
      encodeMipsMessage({id: 1, payload: JSON.stringify(update)}),
    );
  }

  notifyDeviceListChanged(dids: readonly string[]): void {
    this.emit(
      'message',
      'virtual-did/appMsg/devListChange',
      encodeMipsMessage({
        id: 1,
        payload: JSON.stringify({devList: dids}),
      }),
    );
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (condition()) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error('Expected condition was not reached.');
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
