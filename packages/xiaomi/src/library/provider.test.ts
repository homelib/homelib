import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {DehumidifierEndpoint, LightEndpoint} from '@homelib/core';

import {
  miotDehumidifierEndpointAdapter,
  miotLightEndpointAdapter,
} from './devices/index.js';
import {getMiotEndpointConnectionResourceKeys} from './endpoint-connection.js';
import type {MiotSpecInstance} from './miot/index.js';
import {$xiaomi, MiotProvider} from './provider.js';

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

test('rejects duplicate provider declarations', () => {
  $xiaomi('home');

  expect(() => $xiaomi('home')).toThrow('Duplicate provider: home.');
});

test('routes endpoint binding plans through the exact endpoint adapter', () => {
  class SpecializedLightEndpoint extends LightEndpoint {}

  const [candidate] = miotLightEndpointAdapter.findMetadataCandidates(
    {did: 'device', model: 'test.light'},
    LIGHT_SPEC,
  );

  if (candidate === undefined) {
    throw new Error('Test light has no MIoT metadata candidate.');
  }

  const provider = new MiotProvider('provider');
  const plan = provider.createEndpointConnectionBindingPlan(
    new LightEndpoint(),
    candidate.metadata,
  );

  expect(plan.resourceKeys).toEqual(
    getMiotEndpointConnectionResourceKeys(candidate.metadata),
  );
  expect(() =>
    provider.createEndpointConnectionBindingPlan(
      new SpecializedLightEndpoint(),
      candidate.metadata,
    ),
  ).toThrow('Unsupported MIoT endpoint.');
});

test('claims every service used by a multi-service endpoint', () => {
  const [candidate] = miotDehumidifierEndpointAdapter.findMetadataCandidates(
    {did: 'dehumidifier', model: 'xiaomi.derh.13l'},
    DEHUMIDIFIER_SPEC,
  );

  if (candidate === undefined) {
    throw new Error('Test dehumidifier has no MIoT metadata candidate.');
  }

  const provider = new MiotProvider('provider');
  const plan = provider.createEndpointConnectionBindingPlan(
    new DehumidifierEndpoint(),
    candidate.metadata,
  );

  expect(plan.resourceKeys).toEqual([
    JSON.stringify(['dehumidifier', 2]),
    JSON.stringify(['dehumidifier', 3]),
  ]);
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

  await expect(
    internals.createEndpointConnectionBinding(
      {
        createBinding() {
          throw creationError;
        },
      },
      {},
      {},
    ),
  ).rejects.toBe(creationError);

  expect(internals.endpointConnectionCreationCount).toBe(0);
  expect(internals.endpointConnectionValues).toEqual([]);
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(reset).toHaveBeenCalledTimes(1);
});

type TestCloud = {
  readonly client: {disconnect(): Promise<void>};
  readonly transport: {};
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
    adapter: {createBinding(...arguments_: unknown[]): never},
    endpoint: object,
    metadata: object,
  ): Promise<unknown>;
  disposeEndpointConnection(connection: object): Promise<void>;
  disposeCloudIfUnused(expectedCloud?: TestCloud): Promise<void>;
};

function getProviderCleanupInternals(
  provider: MiotProvider,
): ProviderCleanupInternals {
  return provider as unknown as ProviderCleanupInternals;
}

function createTestCloud(disconnect: () => Promise<void>): TestCloud {
  return {client: {disconnect}, transport: {}};
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
