import {BackendClient} from '../backend/index.js';

import {
  CloudClient,
  type CloudDeviceMessageClient,
  type CloudDeviceStateReader,
} from './client.js';
import type {CloudDeviceListener, CloudDeviceState} from './device.js';
import type {
  CloudMqttConnectionStateListener,
  CloudMqttDeviceMessageHandler,
} from './mqtt.js';

const PROPERTY = {did: 'device-1', siid: 2, piid: 1} as const;
const SECOND_PROPERTY = {did: 'device-1', siid: 2, piid: 2} as const;

test('uses a complete cloud snapshot without reading local properties', async () => {
  const backend = createBackendClient();
  const getProperties = import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockResolvedValue([{...PROPERTY, code: 0, value: 25.6}]);
  const local: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => {
      throw new Error('Local properties should not be read.');
    }),
    getDeviceOnline: import.meta.jest.fn(async () => true),
  };
  const states: CloudDeviceState[] = [];
  const client = new CloudClient(backend, new TestMessageClient(), local);

  const subscription = await client.subscribeDevice(
    PROPERTY.did,
    [PROPERTY],
    createStateListener(states),
  );

  expect(states.at(-1)?.properties[0]?.value).toBe(25.6);
  expect(getProperties).toHaveBeenCalledWith([PROPERTY]);
  expect(local.getProperties).not.toHaveBeenCalled();
  await subscription.dispose();
});

test('falls back to local properties when cloud transport fails', async () => {
  const backend = createBackendClient();
  const getProperties = import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockRejectedValue(new Error('Cloud unavailable.'));
  const local: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => [
      {...PROPERTY, code: 0, value: 26},
    ]),
    getDeviceOnline: import.meta.jest.fn(async () => true),
  };
  const states: CloudDeviceState[] = [];
  const client = new CloudClient(backend, new TestMessageClient(), local);

  const subscription = await client.subscribeDevice(
    PROPERTY.did,
    {snapshotProperties: [PROPERTY]},
    createStateListener(states),
  );

  expect(getProperties).toHaveBeenCalledWith([PROPERTY]);
  expect(local.getProperties).toHaveBeenCalledWith([PROPERTY]);
  expect(states.at(-1)?.properties[0]?.value).toBe(26);
  await subscription.dispose();
});

test('falls back to local properties when cloud returns a MIoT error', async () => {
  const backend = createBackendClient();
  const getProperties = import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockResolvedValue([{...PROPERTY, code: -704030013}]);
  const local: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => [
      {...PROPERTY, code: 0, value: 26.5},
    ]),
    getDeviceOnline: import.meta.jest.fn(async () => true),
  };
  const states: CloudDeviceState[] = [];
  const client = new CloudClient(backend, new TestMessageClient(), local);

  const subscription = await client.subscribeDevice(
    PROPERTY.did,
    {snapshotProperties: [PROPERTY]},
    createStateListener(states),
  );

  expect(getProperties).toHaveBeenCalledWith([PROPERTY]);
  expect(local.getProperties).toHaveBeenCalledWith([PROPERTY]);
  expect(states.at(-1)?.properties[0]?.value).toBe(26.5);
  await subscription.dispose();
});

test('fills only failed cloud properties from local state', async () => {
  const backend = createBackendClient();
  const getProperties = import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockResolvedValue([
      {...PROPERTY, code: 0, value: 1},
      {...SECOND_PROPERTY, code: -704220043},
    ]);
  const local: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => [
      {...PROPERTY, code: 0, value: 5},
      {...SECOND_PROPERTY, code: 0, value: 45},
    ]),
    getDeviceOnline: import.meta.jest.fn(async () => true),
  };
  const states: CloudDeviceState[] = [];
  const client = new CloudClient(backend, new TestMessageClient(), local);

  const subscription = await client.subscribeDevice(
    PROPERTY.did,
    {snapshotProperties: [PROPERTY, SECOND_PROPERTY]},
    createStateListener(states),
  );

  expect(getProperties).toHaveBeenCalledWith([PROPERTY, SECOND_PROPERTY]);
  expect(local.getProperties).toHaveBeenCalledWith([SECOND_PROPERTY]);
  expect(
    states.at(-1)?.properties.map(({piid, value}) => [piid, value]),
  ).toEqual([
    [PROPERTY.piid, 1],
    [SECOND_PROPERTY.piid, 45],
  ]);
  await subscription.dispose();
});

test.each([
  ['an omitted property', []],
  [
    'a duplicate property',
    [
      {...SECOND_PROPERTY, code: 0, value: 40},
      {...SECOND_PROPERTY, code: 0, value: 41},
    ],
  ],
  ['a property without a value', [{...SECOND_PROPERTY, code: 0}]],
] as const)(
  'fills %s from local state',
  async (_description, invalidResults) => {
    const backend = createBackendClient();
    import.meta.jest
      .spyOn(backend, 'getProperties')
      .mockResolvedValue([
        {...PROPERTY, code: 0, value: true},
        ...invalidResults,
      ]);
    const local: CloudDeviceStateReader = {
      getProperties: import.meta.jest.fn(async () => [
        {...SECOND_PROPERTY, code: 0, value: 42},
      ]),
      getDeviceOnline: import.meta.jest.fn(async () => true),
    };
    const states: CloudDeviceState[] = [];
    const client = new CloudClient(backend, new TestMessageClient(), local);

    const subscription = await client.subscribeDevice(
      PROPERTY.did,
      {snapshotProperties: [PROPERTY, SECOND_PROPERTY]},
      createStateListener(states),
    );

    expect(local.getProperties).toHaveBeenCalledWith([SECOND_PROPERTY]);
    expect(states.at(-1)?.properties.map(({value}) => value)).toEqual([
      true,
      42,
    ]);
    await subscription.dispose();
  },
);

test('preserves a cloud property error when local cannot fill it', async () => {
  const backend = createBackendClient();
  import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockResolvedValue([{...PROPERTY, code: -704220043}]);
  const local: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => [
      {...PROPERTY, code: -4004},
    ]),
    getDeviceOnline: import.meta.jest.fn(async () => true),
  };
  const client = new CloudClient(backend, new TestMessageClient(), local);

  await expect(
    client.subscribeDevice(
      PROPERTY.did,
      {snapshotProperties: [PROPERTY]},
      createStateListener([]),
    ),
  ).rejects.toThrow('Cloud snapshot property 2.1 failed: -704220043.');
});

test('preserves a cloud transport failure when local state is incomplete', async () => {
  const backend = createBackendClient();
  const cloudError = new Error('Cloud unavailable.');
  import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockRejectedValue(cloudError);
  const local: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => []),
    getDeviceOnline: import.meta.jest.fn(async () => true),
  };
  const client = new CloudClient(backend, new TestMessageClient(), local);

  await expect(
    client.subscribeDevice(
      PROPERTY.did,
      {snapshotProperties: [PROPERTY]},
      createStateListener([]),
    ),
  ).rejects.toBe(cloudError);
});

function createBackendClient(): BackendClient {
  return new BackendClient({
    uuid: '00000000-0000-0000-0000-000000000001',
    accessToken: 'test-access-token',
    cloudServer: 'cn',
  });
}

function createStateListener(states: CloudDeviceState[]): CloudDeviceListener {
  return {
    onStateChanged: state => {
      states.push(state);
    },
  };
}

class TestMessageClient implements CloudDeviceMessageClient {
  updateAccessToken(_accessToken: string): void {}

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async subscribeDevice(
    _did: string,
    _handler: CloudMqttDeviceMessageHandler,
  ): Promise<void> {}

  async unsubscribeDevice(_did: string): Promise<void> {}

  addConnectionStateListener(
    _listener: CloudMqttConnectionStateListener,
  ): () => void {
    return () => undefined;
  }
}
