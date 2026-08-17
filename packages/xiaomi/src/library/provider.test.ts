import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  AirConditioner,
  AirConditionerEndpoint,
  Dehumidifier,
  DehumidifierEndpoint,
  Device,
  Light,
  LightEndpoint,
} from '@homelib/core';

import type {
  CloudDeviceListener,
  CloudDeviceSubscription,
  CloudDeviceSubscriptionRequest,
} from './cloud/index.js';
import {
  createMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionMetadata,
} from './device.js';
import {MiotLightEndpointConnection} from './devices/index.js';
import {
  type LegacyMiotEndpointConnectionMetadata,
  type MiotEndpointConnectionResolvedMetadata,
  getMiotEndpointConnectionResourceKeys,
} from './endpoint-connection.js';
import type {MiotEvent, MiotProperty, MiotSpecInstance} from './miot/index.js';
import {$xiaomi, MiotProvider} from './provider.js';
import './index.js';

const LIGHT_SPEC: MiotSpecInstance = {
  type: 'urn:miot-spec-v2:device:light:0000A001:test-light:1',
  description: 'Test light',
  services: [
    {
      iid: 2,
      type: 'urn:miot-spec-v2:service:light:00007802:test-light:1',
      description: 'Light',
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:on:00000006:test-light:1',
          description: 'Switch Status',
          format: 'bool',
          access: ['read', 'write', 'notify'],
        },
      ],
    },
  ],
};

const DEHUMIDIFIER_SPEC: MiotSpecInstance = {
  type: 'urn:miot-spec-v2:device:dehumidifier:0000A02D:xiaomi-13l:1',
  description: 'Test dehumidifier',
  services: [
    {
      iid: 2,
      type: 'urn:miot-spec-v2:service:dehumidifier:00007841:test:1',
      description: 'Dehumidifier',
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:on:00000006:test:1',
          description: 'Switch Status',
          format: 'bool',
          access: ['read', 'write', 'notify'],
        },
      ],
    },
    {
      iid: 3,
      type: 'urn:miot-spec-v2:service:environment:0000780A:test:1',
      description: 'Environment',
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:relative-humidity:0000000C:test:1',
          description: 'Relative Humidity',
          format: 'uint8',
          access: ['read', 'notify'],
          unit: 'percentage',
          'value-range': [0, 100, 1],
        },
        {
          iid: 2,
          type: 'urn:miot-spec-v2:property:temperature:00000020:test:1',
          description: 'Temperature',
          format: 'float',
          access: ['read', 'notify'],
          unit: 'celsius',
          'value-range': [-30, 100, 1],
        },
      ],
    },
  ],
};

const AIR_CONDITIONER_SPEC: MiotSpecInstance = {
  type: 'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-rr6r00:3',
  description: 'Test air conditioner',
  services: [
    {
      iid: 2,
      type: 'urn:miot-spec-v2:service:air-conditioner:0000780F:test:1',
      description: 'Air Conditioner',
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:on:00000006:test:1',
          description: 'Switch Status',
          format: 'bool',
          access: ['read', 'write', 'notify'],
        },
      ],
    },
    {
      iid: 3,
      type: 'urn:miot-spec-v2:service:fan-control:00007809:test:1',
      description: 'Fan Control',
      properties: [
        {
          iid: 2,
          type: 'urn:miot-spec-v2:property:fan-level:00000016:test:1',
          description: 'Fan Level',
          format: 'uint8',
          access: ['read', 'write', 'notify'],
          'value-list': [
            {value: 0, description: 'Auto'},
            {value: 1, description: 'Level 1'},
          ],
        },
      ],
    },
    {
      iid: 4,
      type: 'urn:miot-spec-v2:service:environment:0000780A:test:1',
      description: 'Environment',
      properties: [
        {
          iid: 7,
          type: 'urn:miot-spec-v2:property:temperature:00000020:test:1',
          description: 'Temperature',
          format: 'float',
          access: ['read', 'notify'],
          unit: 'celsius',
          'value-range': [-50, 150, 0.1],
        },
        {
          iid: 9,
          type: 'urn:miot-spec-v2:property:relative-humidity:0000000C:test:1',
          description: 'Relative Humidity',
          format: 'uint8',
          access: ['read', 'notify'],
          unit: 'percentage',
          'value-range': [0, 100, 1],
        },
      ],
    },
  ],
};

test('rejects duplicate provider declarations', () => {
  $xiaomi('home');

  expect(() => $xiaomi('home')).toThrow('Duplicate provider: home.');
});

test('routes endpoint binding plans through the exact endpoint connection', async () => {
  class SpecializedLightEndpoint extends LightEndpoint {}

  const metadata = createMiotEndpointConnectionMetadata(
    {did: 'device', model: 'test.light'},
    LIGHT_SPEC,
  );
  const provider = new MiotProvider('provider');
  import.meta.jest
    .spyOn(provider, 'getSpecInstance')
    .mockResolvedValue(LIGHT_SPEC);
  const plan = provider.createEndpointConnectionBindingPlan(
    new LightEndpoint(),
    [Light],
    metadata,
  );
  const preparedPlan = await plan.prepare();
  const resolvedMetadata = resolveMiotEndpointConnectionMetadata(
    MiotLightEndpointConnection,
    metadata,
    LIGHT_SPEC,
  );

  expect(preparedPlan.resourceKeys).toEqual(
    getMiotEndpointConnectionResourceKeys(resolvedMetadata),
  );
  expect(preparedPlan.persistedMetadata).toEqual(metadata);
  expect(() =>
    provider.createEndpointConnectionBindingPlan(
      new SpecializedLightEndpoint(),
      [Light],
      metadata,
    ),
  ).toThrow('Unsupported MIoT endpoint.');
  expect(() =>
    provider.createEndpointConnectionBindingPlan(
      new LightEndpoint(),
      [class UnregisteredDevice extends Device {}],
      metadata,
    ),
  ).toThrow('Unsupported MIoT endpoint.');
});

test('claims every service used by a multi-service endpoint', async () => {
  const metadata = createMiotEndpointConnectionMetadata(
    {did: 'dehumidifier', model: 'xiaomi.derh.13l'},
    DEHUMIDIFIER_SPEC,
  );
  const provider = new MiotProvider('provider');
  import.meta.jest
    .spyOn(provider, 'getSpecInstance')
    .mockResolvedValue(DEHUMIDIFIER_SPEC);
  const plan = provider.createEndpointConnectionBindingPlan(
    new DehumidifierEndpoint(),
    [Dehumidifier],
    metadata,
  );
  const preparedPlan = await plan.prepare();

  expect(preparedPlan.resourceKeys).toEqual([
    JSON.stringify(['dehumidifier', 2]),
    JSON.stringify(['dehumidifier', 3]),
  ]);
});

test('migrates a legacy endpoint from selected service snapshots to current schema', async () => {
  const legacyMetadata = createLegacyAirConditionerMetadata();
  const provider = new MiotProvider('provider');
  const getSpecInstance = import.meta.jest
    .spyOn(provider, 'getSpecInstance')
    .mockResolvedValue(AIR_CONDITIONER_SPEC);
  const getCloud = import.meta.jest.fn(async (): Promise<TestCloud> => {
    throw new Error('Cloud must not be loaded while preparing a binding.');
  });

  getProviderCleanupInternals(provider).getCloud = getCloud;

  const preparedPlan = await provider
    .createEndpointConnectionBindingPlan(
      new AirConditionerEndpoint(),
      [AirConditioner],
      legacyMetadata,
    )
    .prepare();

  expect(getSpecInstance).toHaveBeenCalledWith(AIR_CONDITIONER_SPEC.type);
  expect(getCloud).not.toHaveBeenCalled();
  expect(preparedPlan.resourceKeys).toEqual([
    JSON.stringify(['air-conditioner', 2]),
    JSON.stringify(['air-conditioner', 3]),
    JSON.stringify(['air-conditioner', 4]),
  ]);
  expect(preparedPlan.persistedMetadata).toEqual({
    version: 1,
    device: legacyMetadata.device,
  });
});

test('force refreshes a stale full spec before migrating legacy metadata', async () => {
  const legacyMetadata = createLegacyAirConditionerMetadata();
  const provider = new MiotProvider('provider');
  const staleSpec = {...AIR_CONDITIONER_SPEC, services: []};
  const getSpecInstance = import.meta.jest
    .spyOn(provider, 'getSpecInstance')
    .mockResolvedValue(staleSpec);
  const refreshSpecInstance = import.meta.jest
    .spyOn(provider, 'refreshSpecInstance')
    .mockResolvedValue(AIR_CONDITIONER_SPEC);

  const preparedPlan = await provider
    .createEndpointConnectionBindingPlan(
      new AirConditionerEndpoint(),
      [AirConditioner],
      legacyMetadata,
    )
    .prepare();

  expect(getSpecInstance).toHaveBeenCalledTimes(1);
  expect(refreshSpecInstance).toHaveBeenCalledWith(AIR_CONDITIONER_SPEC.type);
  expect(preparedPlan.resourceKeys).toEqual([
    JSON.stringify(['air-conditioner', 2]),
    JSON.stringify(['air-conditioner', 3]),
    JSON.stringify(['air-conditioner', 4]),
  ]);
  expect(preparedPlan.persistedMetadata).toEqual({
    version: 1,
    device: legacyMetadata.device,
  });
});

test('force refreshes a stale full spec for current metadata', async () => {
  const metadata = createMiotEndpointConnectionMetadata(
    {did: 'air-conditioner', model: 'xiaomi.aircondition.rr6r00'},
    AIR_CONDITIONER_SPEC,
  );
  const provider = new MiotProvider('provider');
  const staleSpec = {...AIR_CONDITIONER_SPEC, services: []};

  import.meta.jest
    .spyOn(provider, 'getSpecInstance')
    .mockResolvedValue(staleSpec);
  const refreshSpecInstance = import.meta.jest
    .spyOn(provider, 'refreshSpecInstance')
    .mockResolvedValue(AIR_CONDITIONER_SPEC);

  const preparedPlan = await provider
    .createEndpointConnectionBindingPlan(
      new AirConditionerEndpoint(),
      [AirConditioner],
      metadata,
    )
    .prepare();

  expect(refreshSpecInstance).toHaveBeenCalledWith(AIR_CONDITIONER_SPEC.type);
  expect(preparedPlan.resourceKeys).toEqual([
    JSON.stringify(['air-conditioner', 2]),
    JSON.stringify(['air-conditioner', 3]),
    JSON.stringify(['air-conditioner', 4]),
  ]);
  expect(preparedPlan.persistedMetadata).toEqual(metadata);
});

test('rejects current metadata when a stale spec cannot be refreshed', async () => {
  const metadata = createMiotEndpointConnectionMetadata(
    {did: 'air-conditioner', model: 'xiaomi.aircondition.rr6r00'},
    AIR_CONDITIONER_SPEC,
  );
  const provider = new MiotProvider('provider');

  import.meta.jest
    .spyOn(provider, 'getSpecInstance')
    .mockResolvedValue({...AIR_CONDITIONER_SPEC, services: []});
  const refreshSpecInstance = import.meta.jest
    .spyOn(provider, 'refreshSpecInstance')
    .mockRejectedValue(new Error('Spec refresh unavailable.'));

  await expect(
    provider
      .createEndpointConnectionBindingPlan(
        new AirConditionerEndpoint(),
        [AirConditioner],
        metadata,
      )
      .prepare(),
  ).rejects.toThrow('Spec refresh unavailable.');
  expect(refreshSpecInstance).toHaveBeenCalledWith(AIR_CONDITIONER_SPEC.type);
});

test.each([
  {
    name: 'spec loading fails',
    loadSpec: () => Promise.reject(new Error('Spec unavailable.')),
    refreshSpec: () => Promise.reject(new Error('Unexpected spec refresh.')),
    refreshCount: 0,
  },
  {
    name: 'the complete spec no longer matches',
    loadSpec: () => Promise.resolve({...AIR_CONDITIONER_SPEC, services: []}),
    refreshSpec: () => Promise.resolve({...AIR_CONDITIONER_SPEC, services: []}),
    refreshCount: 1,
  },
])(
  'falls back to a legacy snapshot when $name',
  async ({loadSpec, refreshSpec, refreshCount}) => {
    const legacyMetadata = createLegacyAirConditionerMetadata();
    const provider = new MiotProvider('provider');

    import.meta.jest
      .spyOn(provider, 'getSpecInstance')
      .mockImplementation(loadSpec as () => Promise<MiotSpecInstance>);
    const refreshSpecInstance = import.meta.jest
      .spyOn(provider, 'refreshSpecInstance')
      .mockImplementation(refreshSpec as () => Promise<MiotSpecInstance>);

    const preparedPlan = await provider
      .createEndpointConnectionBindingPlan(
        new AirConditionerEndpoint(),
        [AirConditioner],
        legacyMetadata,
      )
      .prepare();

    expect(refreshSpecInstance).toHaveBeenCalledTimes(refreshCount);
    expect(preparedPlan.resourceKeys).toEqual([
      JSON.stringify(['air-conditioner', 2]),
      JSON.stringify(['air-conditioner', 4]),
    ]);
    expect(preparedPlan.persistedMetadata).toEqual(legacyMetadata);
  },
);

test('wires snapshot state, refresh events, and invalidation through the cloud subscription', async () => {
  const provider = new MiotProvider('snapshot-refresh-wiring');
  const internals = getProviderCleanupInternals(provider);
  const property = {did: 'device', siid: 2, piid: 1} as const;
  const secondProperty = {did: 'device', siid: 2, piid: 2} as const;
  const event = {did: 'device', siid: 2, eiid: 1} as const;
  const notification = {type: 'event', data: event} as const;
  const stateErrors = [
    new Error('First snapshot property failed.'),
    new Error('Second snapshot property failed.'),
  ];
  const handleStateUpdate = import.meta.jest.fn(() => stateErrors);
  const handleSnapshotInvalidation = import.meta.jest.fn();
  const connection: ProviderSubscriptionConnection = {
    metadata: {device: {did: 'device'}},
    snapshotProperties: [property, secondProperty],
    snapshotRefreshEvents: [event],
    notificationTargets: [notification],
    replaySnapshotPropertyNotifications: [],
    handleStateUpdate,
    handleNotification: import.meta.jest.fn(),
    handleSnapshotInvalidation,
  };
  const subscription: CloudDeviceSubscription = {
    refresh: async () => undefined,
    dispose: async () => undefined,
  };
  let request: CloudDeviceSubscriptionRequest | undefined;
  let listener: CloudDeviceListener | undefined;
  const subscribeDevice = import.meta.jest.fn(
    async (
      _did: string,
      nextRequest: CloudDeviceSubscriptionRequest,
      nextListener: CloudDeviceListener,
    ) => {
      request = nextRequest;
      listener = nextListener;
      return subscription;
    },
  );

  await internals.subscribeEndpointConnection(
    connection,
    {subscribeDevice},
    {active: true},
  );

  expect(subscribeDevice).toHaveBeenCalledTimes(1);
  expect(subscribeDevice).toHaveBeenCalledWith(
    'device',
    {
      snapshotProperties: [property, secondProperty],
      refreshSnapshotOnEvents: [event],
      notifications: [notification],
      replaySnapshotPropertyNotifications: [],
    },
    expect.any(Object),
  );

  const state = {did: 'device', online: true, properties: []} as const;
  const consoleError = import.meta.jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);

  try {
    listener?.onStateChanged?.(state);

    expect(handleStateUpdate).toHaveBeenCalledWith(state);
    expect(consoleError).toHaveBeenNthCalledWith(1, stateErrors[0]);
    expect(consoleError).toHaveBeenNthCalledWith(2, stateErrors[1]);
  } finally {
    consoleError.mockRestore();
  }

  const invalidatedProperties = [property];
  listener?.onSnapshotInvalidated?.(invalidatedProperties);

  expect(request?.refreshSnapshotOnEvents).toEqual([event]);
  expect(handleSnapshotInvalidation).toHaveBeenCalledWith(
    invalidatedProperties,
  );
  expect(internals.endpointConnectionSubscriptionMap.get(connection)).toBe(
    subscription,
  );
});

test('forgets the local session while preserving identity and configuration', async () => {
  const previousEnvironmentDirectory = process.env.HOMELIB_DIRECTORY;
  const environmentDirectory = await mkdtemp(
    join(tmpdir(), 'homelib-miot-provider-test-'),
  );

  try {
    process.env.HOMELIB_DIRECTORY = environmentDirectory;

    const providerDirectory = join(environmentDirectory, 'providers', 'miot');
    const sessionPath = join(providerDirectory, 'home.json');
    const identityPath = join(providerDirectory, 'identity', 'home.json');
    const configurationPath = join(providerDirectory, 'config', 'home.json');

    await Promise.all([
      mkdir(join(providerDirectory, 'identity'), {recursive: true}),
      mkdir(join(providerDirectory, 'config'), {recursive: true}),
    ]);
    await Promise.all([
      writeFile(sessionPath, 'session'),
      writeFile(identityPath, 'identity'),
      writeFile(configurationPath, 'configuration'),
    ]);

    const provider = new MiotProvider('home');

    await provider.configuration.forgetAuthorization();
    await provider.configuration.forgetAuthorization();

    await expect(readFile(sessionPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(identityPath, 'utf8')).resolves.toBe('identity');
    await expect(readFile(configurationPath, 'utf8')).resolves.toBe(
      'configuration',
    );
  } finally {
    if (previousEnvironmentDirectory === undefined) {
      delete process.env.HOMELIB_DIRECTORY;
    } else {
      process.env.HOMELIB_DIRECTORY = previousEnvironmentDirectory;
    }

    await rm(environmentDirectory, {recursive: true, force: true});
  }
});

test('cleans up a connection even when its subscription disposal fails', async () => {
  const provider = new MiotProvider('cleanup-failure');
  const internals = getProviderCleanupInternals(provider);
  const connection = {};
  const disposalError = new Error('Subscription disposal failed.');
  const disconnect = import.meta.jest.fn(async () => undefined);
  const reset = import.meta.jest
    .spyOn(internals.sessionManager, 'reset')
    .mockResolvedValue();
  const cloud = createTestCloud(disconnect);

  internals.endpointConnectionValues.push(connection);
  internals.endpointConnectionRuntimeMap.set(connection, {
    active: true,
    backoff: {reset: import.meta.jest.fn()},
    subscriptionPromise: Promise.resolve(),
  });
  internals.endpointConnectionSubscriptionMap.set(connection, {
    dispose: () => Promise.reject(disposalError),
  });
  internals.cloudValue = cloud;
  internals.cloudPromise = Promise.resolve(cloud);

  await expect(internals.disposeEndpointConnection(connection)).rejects.toBe(
    disposalError,
  );
  expect(internals.endpointConnectionValues).toEqual([]);
  expect(internals.endpointConnectionRuntimeMap.size).toBe(0);
  expect(internals.endpointConnectionSubscriptionMap.size).toBe(0);
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(reset).toHaveBeenCalledTimes(1);
});

test('disconnects shared cloud only after concurrent connection disposals settle', async () => {
  const provider = new MiotProvider('concurrent-cleanup');
  const internals = getProviderCleanupInternals(provider);
  const connections = [{}, {}];
  const disposalOperations = [createDeferred<void>(), createDeferred<void>()];
  const disconnect = import.meta.jest.fn(async () => undefined);
  const reset = import.meta.jest
    .spyOn(internals.sessionManager, 'reset')
    .mockResolvedValue();
  const cloud = createTestCloud(disconnect);

  internals.cloudValue = cloud;
  internals.cloudPromise = Promise.resolve(cloud);

  for (const [index, connection] of connections.entries()) {
    const disposalOperation = disposalOperations[index];

    if (disposalOperation === undefined) {
      throw new Error('Missing test disposal operation.');
    }

    internals.endpointConnectionValues.push(connection);
    internals.endpointConnectionRuntimeMap.set(connection, {
      active: true,
      backoff: {reset: import.meta.jest.fn()},
      subscriptionPromise: Promise.resolve(),
    });
    internals.endpointConnectionSubscriptionMap.set(connection, {
      dispose: () => disposalOperation.promise,
    });
  }

  const disposals = connections.map(connection =>
    internals.disposeEndpointConnection(connection),
  );
  await flushMicrotasks();
  disposalOperations[0]?.resolve();
  await flushMicrotasks();

  expect(disconnect).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();

  disposalOperations[1]?.resolve();
  await Promise.all(disposals);

  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(reset).toHaveBeenCalledTimes(1);
});

test('does not reset a new cloud created while the old cloud disconnects', async () => {
  const provider = new MiotProvider('cloud-replacement');
  const internals = getProviderCleanupInternals(provider);
  const oldDisconnect = createDeferred<void>();
  const oldCloud = createTestCloud(() => oldDisconnect.promise);
  const newCloud = createTestCloud(async () => undefined);
  const reset = import.meta.jest
    .spyOn(internals.sessionManager, 'reset')
    .mockResolvedValue();

  internals.cloudValue = oldCloud;
  internals.cloudPromise = Promise.resolve(oldCloud);
  const disposal = internals.disposeCloudIfUnused(oldCloud);

  internals.cloudValue = newCloud;
  internals.cloudPromise = Promise.resolve(newCloud);
  oldDisconnect.resolve();
  await disposal;

  expect(internals.cloudValue).toBe(newCloud);
  expect(reset).not.toHaveBeenCalled();
});

test('releases an acquired cloud when binding creation fails', async () => {
  const provider = new MiotProvider('creation-failure');
  const internals = getProviderCleanupInternals(provider);
  const creationError = new Error('Connection construction failed.');
  const disconnect = import.meta.jest.fn(async () => undefined);
  const reset = import.meta.jest
    .spyOn(internals.sessionManager, 'reset')
    .mockResolvedValue();
  const cloud = createTestCloud(disconnect);

  internals.cloudValue = cloud;
  internals.cloudPromise = Promise.resolve(cloud);
  internals.getCloud = () => Promise.resolve(cloud);

  class FailingLightConnection extends MiotLightEndpointConnection {
    constructor(
      ..._arguments: ConstructorParameters<typeof MiotLightEndpointConnection>
    ) {
      super(..._arguments);
      throw creationError;
    }
  }

  await expect(
    internals.createEndpointConnectionBinding(
      FailingLightConnection,
      new LightEndpoint(),
      createTestLightResolvedMetadata(),
    ),
  ).rejects.toBe(creationError);

  expect(internals.endpointConnectionCreationCount).toBe(0);
  expect(internals.endpointConnectionValues).toEqual([]);
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(reset).toHaveBeenCalledTimes(1);
});

type TestCloud = {
  readonly client: {connect(): Promise<void>; disconnect(): Promise<void>};
  readonly localController: {};
  readonly transport: {};
};

type ProviderSubscriptionConnection = {
  readonly metadata: {readonly device: {readonly did: string}};
  readonly snapshotProperties: readonly MiotProperty[];
  readonly snapshotRefreshEvents: readonly MiotEvent[];
  readonly notificationTargets: readonly object[];
  readonly replaySnapshotPropertyNotifications: readonly MiotProperty[];
  handleStateUpdate(state: unknown): readonly Error[];
  handleNotification(notification: unknown): void;
  handleSnapshotInvalidation(properties: readonly MiotProperty[]): void;
};

type ProviderSubscriptionCloudClient = {
  subscribeDevice(
    did: string,
    request: CloudDeviceSubscriptionRequest,
    listener: CloudDeviceListener,
  ): Promise<CloudDeviceSubscription>;
};

type ProviderCleanupInternals = {
  endpointConnectionValues: object[];
  endpointConnectionRuntimeMap: Map<
    object,
    {
      active: boolean;
      readonly backoff: {reset(): void};
      subscriptionPromise?: Promise<void>;
    }
  >;
  endpointConnectionSubscriptionMap: Map<object, {dispose(): Promise<void>}>;
  endpointConnectionCreationCount: number;
  cloudValue: TestCloud | undefined;
  cloudPromise: Promise<TestCloud> | undefined;
  sessionManager: {reset(): Promise<void>};
  getCloud(): Promise<TestCloud>;
  createEndpointConnectionBinding(
    Connection: typeof MiotLightEndpointConnection,
    endpoint: LightEndpoint,
    metadata: ReturnType<typeof createTestLightResolvedMetadata>,
  ): Promise<unknown>;
  subscribeEndpointConnection(
    connection: ProviderSubscriptionConnection,
    cloudClient: ProviderSubscriptionCloudClient,
    runtime: {active: boolean},
  ): Promise<void>;
  disposeEndpointConnection(connection: object): Promise<void>;
  disposeCloudIfUnused(expectedCloud?: TestCloud): Promise<void>;
};

function getProviderCleanupInternals(
  provider: MiotProvider,
): ProviderCleanupInternals {
  return provider as unknown as ProviderCleanupInternals;
}

function createLegacyAirConditionerMetadata(): LegacyMiotEndpointConnectionMetadata {
  const services = [2, 4].map(iid => {
    const service = AIR_CONDITIONER_SPEC.services.find(
      candidate => candidate.iid === iid,
    );

    if (service === undefined) {
      throw new Error(`Missing test MIoT service: ${iid}.`);
    }

    return {service};
  });

  return {
    device: {
      did: 'air-conditioner',
      model: 'xiaomi.aircondition.rr6r00',
      urn: AIR_CONDITIONER_SPEC.type,
    },
    resources: services,
  };
}

function createTestLightResolvedMetadata(): MiotEndpointConnectionResolvedMetadata {
  const metadata = createMiotEndpointConnectionMetadata(
    {did: 'device', model: 'test.light'},
    LIGHT_SPEC,
  );

  return resolveMiotEndpointConnectionMetadata(
    MiotLightEndpointConnection,
    metadata,
    LIGHT_SPEC,
  );
}

function createTestCloud(disconnect: () => Promise<void>): TestCloud {
  return {
    client: {connect: async () => undefined, disconnect},
    localController: {},
    transport: {},
  };
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value?: T) => void;
} {
  let resolve = (_value?: T): void => undefined;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise as (value?: T) => void;
  });

  return {promise, resolve};
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
