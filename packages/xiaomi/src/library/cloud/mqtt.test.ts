import {EventEmitter} from 'node:events';

import type {IClientOptions, MqttClient} from 'mqtt';

import {CloudMqttClient, type CloudMqttDeviceMessage} from './mqtt.js';

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
  client.observeConnectionState(connected => {
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

  expect(messages).toEqual([
    {
      type: 'property',
      did: 'device-1',
      siid: 2,
      piid: 1,
      value: true,
    },
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

class TestMqttClient extends EventEmitter {
  connected = true;

  options: IClientOptions = {};

  readonly subscribeCalls: Array<{
    readonly topics: readonly string[];
    readonly options: unknown;
  }> = [];

  readonly unsubscribeCalls: string[][] = [];

  async subscribeAsync(
    topics: string[],
    options: unknown,
  ): Promise<Array<{readonly topic: string; readonly qos: 2}>> {
    this.subscribeCalls.push({topics, options});
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

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (condition()) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error('Expected condition was not reached.');
}
