import {BackendClient} from '../../backend/index.js';
import {
  CloudClient,
  type CloudDeviceMessageClient,
  type CloudDeviceStateReader,
} from '../../cloud/client.js';
import type {
  CloudDeviceListener,
  CloudDeviceState,
} from '../../cloud/device.js';
import type {
  CloudMqttConnectionStateListener,
  CloudMqttDeviceMessageHandler,
} from '../../cloud/mqtt.js';

const PROPERTY = {did: 'device-1', siid: 2, piid: 1} as const;
const SECOND_PROPERTY = {did: 'device-1', siid: 2, piid: 2} as const;
const THIRD_PROPERTY = {did: 'device-1', siid: 2, piid: 3} as const;

test('uses a complete local snapshot by default without reading cloud properties', async () => {
  const backend = createBackendClient();
  const getProperties = import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockRejectedValue(new Error('Cloud properties should not be read.'));
  const local: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => [
      {...PROPERTY, code: 0, value: 25.6},
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

  expect(states.at(-1)?.properties[0]?.value).toBe(25.6);
  expect(local.getProperties).toHaveBeenCalledWith([PROPERTY]);
  expect(getProperties).not.toHaveBeenCalled();
  await subscription.dispose();
});

test('falls back to cloud properties when the local transport fails', async () => {
  const backend = createBackendClient();
  const getProperties = import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockResolvedValue([{...PROPERTY, code: 0, value: 26}]);
  const local: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => {
      throw new Error('Local unavailable.');
    }),
    getDeviceOnline: import.meta.jest.fn(async () => true),
  };
  const states: CloudDeviceState[] = [];
  const client = new CloudClient(backend, new TestMessageClient(), local);

  const subscription = await client.subscribeDevice(
    PROPERTY.did,
    {snapshotProperties: [PROPERTY]},
    createStateListener(states),
  );

  expect(local.getProperties).toHaveBeenCalledWith([PROPERTY]);
  expect(getProperties).toHaveBeenCalledWith([PROPERTY]);
  expect(states.at(-1)?.properties[0]?.value).toBe(26);
  await subscription.dispose();
});

test('reads only explicitly preferred snapshot properties from cloud first', async () => {
  const backend = createBackendClient();
  const getProperties = import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockResolvedValue([{...SECOND_PROPERTY, code: 0, value: 45}]);
  const local: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => [
      {...PROPERTY, code: 0, value: true},
    ]),
    getDeviceOnline: import.meta.jest.fn(async () => true),
  };
  const states: CloudDeviceState[] = [];
  const client = new CloudClient(backend, new TestMessageClient(), local);

  const subscription = await client.subscribeDevice(
    PROPERTY.did,
    {
      snapshotProperties: [PROPERTY, SECOND_PROPERTY],
      cloudPreferredSnapshotProperties: [SECOND_PROPERTY],
    },
    createStateListener(states),
  );

  expect(local.getProperties).toHaveBeenCalledWith([PROPERTY]);
  expect(getProperties).toHaveBeenCalledWith([SECOND_PROPERTY]);
  expect(
    states.at(-1)?.properties.map(({piid, value}) => [piid, value]),
  ).toEqual([
    [PROPERTY.piid, true],
    [SECOND_PROPERTY.piid, 45],
  ]);
  await subscription.dispose();
});

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
    {
      snapshotProperties: [PROPERTY],
      cloudPreferredSnapshotProperties: [PROPERTY],
    },
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
    {
      snapshotProperties: [PROPERTY],
      cloudPreferredSnapshotProperties: [PROPERTY],
    },
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
    {
      snapshotProperties: [PROPERTY],
      cloudPreferredSnapshotProperties: [PROPERTY],
    },
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
    {
      snapshotProperties: [PROPERTY, SECOND_PROPERTY],
      cloudPreferredSnapshotProperties: [PROPERTY, SECOND_PROPERTY],
    },
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
      {
        snapshotProperties: [PROPERTY, SECOND_PROPERTY],
        cloudPreferredSnapshotProperties: [PROPERTY, SECOND_PROPERTY],
      },
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

test('publishes a cloud property error silently when local cannot fill it', async () => {
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
  const states: CloudDeviceState[] = [];
  const errors: unknown[] = [];
  const client = new CloudClient(backend, new TestMessageClient(), local);

  const subscription = await client.subscribeDevice(
    PROPERTY.did,
    {
      snapshotProperties: [PROPERTY],
      cloudPreferredSnapshotProperties: [PROPERTY],
    },
    createStateListener(states, errors),
  );

  expect(states).toEqual([{did: PROPERTY.did, online: true, properties: []}]);
  expect(errors).toEqual([]);
  await subscription.dispose();
});

test('uses an empty local snapshot when cloud transport fails', async () => {
  const backend = createBackendClient();
  const cloudError = new Error('Cloud unavailable.');
  import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockRejectedValue(cloudError);
  const local: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => []),
    getDeviceOnline: import.meta.jest.fn(async () => true),
  };
  const states: CloudDeviceState[] = [];
  const errors: unknown[] = [];
  const client = new CloudClient(backend, new TestMessageClient(), local);

  const subscription = await client.subscribeDevice(
    PROPERTY.did,
    {
      snapshotProperties: [PROPERTY],
      cloudPreferredSnapshotProperties: [PROPERTY],
    },
    createStateListener(states, errors),
  );

  expect(states).toEqual([{did: PROPERTY.did, online: true, properties: []}]);
  expect(errors).toEqual([]);
  await subscription.dispose();
});

test('reports a whole cloud read failure when local fallback also fails', async () => {
  const backend = createBackendClient();
  const cloudError = new Error('Cloud unavailable.');
  import.meta.jest
    .spyOn(backend, 'getProperties')
    .mockRejectedValue(cloudError);
  const local: CloudDeviceStateReader = {
    getProperties: import.meta.jest.fn(async () => {
      throw new Error('Local unavailable.');
    }),
    getDeviceOnline: import.meta.jest.fn(async () => true),
  };
  const states: CloudDeviceState[] = [];
  const errors: unknown[] = [];
  const client = new CloudClient(backend, new TestMessageClient(), local);

  const subscription = await client.subscribeDevice(
    PROPERTY.did,
    {
      snapshotProperties: [PROPERTY],
      cloudPreferredSnapshotProperties: [PROPERTY],
    },
    createStateListener(states, errors),
  );

  expect(states).toEqual([{did: PROPERTY.did, online: true, properties: []}]);
  expect(errors).toEqual([cloudError]);
  await subscription.dispose();
});

test.each([
  ['missing', []],
  [
    'duplicated',
    [
      {...SECOND_PROPERTY, code: 0, value: 40},
      {...SECOND_PROPERTY, code: 0, value: 41},
    ],
  ],
  ['failed', [{...SECOND_PROPERTY, code: -4004}]],
] as const)(
  'uses partial local state when cloud transport fails and a property is %s',
  async (_description, partialResults) => {
    const backend = createBackendClient();
    const cloudError = new Error('Cloud unavailable.');
    import.meta.jest
      .spyOn(backend, 'getProperties')
      .mockRejectedValue(cloudError);
    const local: CloudDeviceStateReader = {
      getProperties: import.meta.jest.fn(async () => [
        {...PROPERTY, code: 0, value: true},
        ...partialResults,
      ]),
      getDeviceOnline: import.meta.jest.fn(async () => true),
    };
    const states: CloudDeviceState[] = [];
    const client = new CloudClient(backend, new TestMessageClient(), local);

    const subscription = await client.subscribeDevice(
      PROPERTY.did,
      {
        snapshotProperties: [PROPERTY, SECOND_PROPERTY],
        cloudPreferredSnapshotProperties: [PROPERTY, SECOND_PROPERTY],
      },
      createStateListener(states),
    );

    expect(states.at(-1)).toMatchObject({
      online: true,
      properties: [{...PROPERTY, value: true}],
    });
    expect(states.at(-1)?.properties).toHaveLength(1);
    expect(local.getProperties).toHaveBeenCalledWith([
      PROPERTY,
      SECOND_PROPERTY,
    ]);
    await subscription.dispose();
  },
);

test.each([
  ['missing', [], undefined],
  [
    'duplicated',
    [
      {...SECOND_PROPERTY, code: 0, value: 40},
      {...SECOND_PROPERTY, code: 0, value: 41},
    ],
    'Cloud snapshot returned duplicate property 2.2.',
  ],
  ['failed', [{...SECOND_PROPERTY, code: -4004}], undefined],
] as const)(
  'publishes partial local state when a local property is %s',
  async (_description, partialResults, expectedError) => {
    const backend = createBackendClient();
    import.meta.jest
      .spyOn(backend, 'getProperties')
      .mockRejectedValue(new Error('Cloud unavailable.'));
    const local: CloudDeviceStateReader = {
      getProperties: import.meta.jest.fn(async () => [
        {...PROPERTY, code: 0, value: true},
        ...partialResults,
      ]),
      getDeviceOnline: import.meta.jest.fn(async () => true),
    };
    const states: CloudDeviceState[] = [];
    const errors: unknown[] = [];
    const client = new CloudClient(backend, new TestMessageClient(), local);

    const subscription = await client.subscribeDevice(
      PROPERTY.did,
      {
        snapshotProperties: [PROPERTY, SECOND_PROPERTY, THIRD_PROPERTY],
        cloudPreferredSnapshotProperties: [
          PROPERTY,
          SECOND_PROPERTY,
          THIRD_PROPERTY,
        ],
      },
      createStateListener(states, errors),
    );

    expect(states.at(-1)).toMatchObject({
      online: true,
      properties: [{...PROPERTY, value: true}],
    });
    expect(errors.map(error => (error as Error).message)).toEqual(
      expectedError === undefined ? [] : [expectedError],
    );
    await subscription.dispose();
  },
);

function createBackendClient(): BackendClient {
  return new BackendClient({
    uuid: '00000000-0000-0000-0000-000000000001',
    accessToken: 'test-access-token',
    cloudServer: 'cn',
  });
}

function createStateListener(
  states: CloudDeviceState[],
  errors: unknown[] = [],
): CloudDeviceListener {
  return {
    onStateChanged: state => {
      states.push(state);
    },
    onError: error => {
      errors.push(error);
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
