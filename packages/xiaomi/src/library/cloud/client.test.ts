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

test('uses a complete preferred state snapshot without cloud HTTP', async () => {
  const backend = createBackendClient();
  const getProperties = import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockRejectedValue(new Error('Cloud should not be used.'));
  const getDeviceOnline = import.meta.jest
    .spyOn(backend, 'getDeviceOnline')
    .mockRejectedValue(new Error('Cloud should not be used.'));
  const preferred: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => [
      {...PROPERTY, code: 0, value: 25.6},
    ]),
    getDeviceOnline: import.meta.jest.fn(async () => true),
  };
  const states: CloudDeviceState[] = [];
  const client = new CloudClient(backend, new TestMessageClient(), preferred);

  const subscription = await client.subscribeDevice(
    PROPERTY.did,
    [PROPERTY],
    createStateListener(states),
  );

  expect(states.at(-1)?.properties[0]?.value).toBe(25.6);
  expect(getProperties).not.toHaveBeenCalled();
  expect(getDeviceOnline).not.toHaveBeenCalled();
  await subscription.dispose();
});

test('falls back to cloud HTTP when preferred snapshot contains a MIoT error', async () => {
  const backend = createBackendClient();
  const getProperties = import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockResolvedValue([{...PROPERTY, code: 0, value: 26}]);
  const preferred: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => [
      {...PROPERTY, code: -704030013},
    ]),
    getDeviceOnline: import.meta.jest.fn(async () => true),
  };
  const states: CloudDeviceState[] = [];
  const client = new CloudClient(backend, new TestMessageClient(), preferred);

  const subscription = await client.subscribeDevice(
    PROPERTY.did,
    {snapshotProperties: [PROPERTY]},
    createStateListener(states),
  );

  expect(getProperties).toHaveBeenCalledWith([PROPERTY]);
  expect(states.at(-1)?.properties[0]?.value).toBe(26);
  await subscription.dispose();
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
