import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

import {
  MiotProviderConfiguration,
  type MiotProviderConfigurationAuthorizationDependency,
  type MiotProviderConfigurationDependencies,
  type MiotProviderConfigurationDiscovery,
} from '../configuration.js';

const TEST_ACCOUNT = {cloudServer: 'cn', userId: 'user-1'} as const;

const TEST_DISCOVERY: MiotProviderConfigurationDiscovery = {
  account: TEST_ACCOUNT,
  homes: [
    {
      source: 'owned',
      id: 'home-1',
      name: 'Home',
      rooms: [{id: 'room-1', name: 'Living Room'}],
    },
    {
      source: 'shared-home',
      id: 'home-2',
      name: 'Shared Home',
      rooms: [],
    },
  ],
  devices: [
    {
      did: 'device-1',
      name: 'Light',
      source: 'owned',
      homeId: 'home-1',
      homeName: 'Home',
      roomId: 'room-1',
      roomName: 'Living Room',
    },
    {
      did: 'device-2',
      name: 'Shared Light',
      source: 'shared-home',
      homeId: 'home-2',
      homeName: 'Shared Home',
    },
    {did: 'device-without-home', name: 'Unassigned'},
  ],
};

let environmentDirectory: string;

beforeEach(async () => {
  environmentDirectory = await mkdtemp(
    join(tmpdir(), 'homelib-miot-configuration-test-'),
  );
});

afterEach(async () => {
  await rm(environmentDirectory, {recursive: true, force: true});
});

test('loads missing configuration as all homes and strips dependency extras', async () => {
  const dependencyDiscovery = {
    account: {...TEST_DISCOVERY.account, token: 'must-not-leak'},
    homes: TEST_DISCOVERY.homes.map(home => ({
      ...home,
      token: 'must-not-leak',
    })),
    devices: TEST_DISCOVERY.devices.map(device => ({
      ...device,
      token: 'must-not-leak',
    })),
    token: 'must-not-leak',
  };
  const configuration = createConfiguration({
    discoverDevices: () => Promise.resolve(dependencyDiscovery),
    beginAuthorization: unexpectedAuthorization,
  });
  await expect(configuration.load()).resolves.toEqual({
    account: TEST_ACCOUNT,
    selectionSource: 'default',
    homes: [
      {source: 'owned', id: 'home-1', name: 'Home', included: true},
      {
        source: 'shared-home',
        id: 'home-2',
        name: 'Shared Home',
        included: true,
      },
    ],
  });

  const discovery = requireDefined(await configuration.discoverDevices());

  expect(discovery).toEqual(TEST_DISCOVERY);
  expect(JSON.stringify(discovery)).not.toContain('must-not-leak');
});

test('fetches the complete provider discovery once and reapplies home filters locally', async () => {
  let discoveryCount = 0;
  const configuration = createConfiguration({
    discoverDevices: () => {
      discoveryCount++;
      return Promise.resolve(TEST_DISCOVERY);
    },
  });

  const [snapshot, initialDiscovery] = await Promise.all([
    configuration.load(),
    configuration.discoverDevices(),
  ]);

  expect(snapshot).toBeDefined();
  expect(initialDiscovery?.devices).toHaveLength(TEST_DISCOVERY.devices.length);
  expect(discoveryCount).toBe(1);

  await configuration.saveIncludedHomes(TEST_ACCOUNT, [
    {source: 'owned', id: 'home-1'},
  ]);
  const filteredDiscovery = requireDefined(
    await configuration.discoverDevices(),
  );

  expect(filteredDiscovery.devices.map(device => device.did)).toEqual([
    'device-1',
  ]);
  expect(discoveryCount).toBe(1);
});

test('returns undefined when authorization is missing', async () => {
  let discoveryCount = 0;
  const configuration = createConfiguration({
    discoverDevices: () => {
      discoveryCount++;
      return Promise.resolve(undefined);
    },
    beginAuthorization: unexpectedAuthorization,
  });
  await expect(configuration.load()).resolves.toBeUndefined();
  await expect(configuration.discoverDevices()).resolves.toBeUndefined();
  expect(discoveryCount).toBe(2);
});

test('retries complete provider discovery after a failure', async () => {
  let discoveryCount = 0;
  const configuration = createConfiguration({
    discoverDevices: () => {
      discoveryCount++;
      return discoveryCount === 1
        ? Promise.reject(new Error('Temporary discovery failure.'))
        : Promise.resolve(TEST_DISCOVERY);
    },
  });

  await expect(configuration.load()).rejects.toThrow(
    'Temporary discovery failure.',
  );
  await expect(configuration.discoverDevices()).resolves.toBeDefined();
  expect(discoveryCount).toBe(2);
});

test('persists an explicit empty selection atomically', async () => {
  const configuration = createConfiguration();

  await configuration.saveIncludedHomes(TEST_ACCOUNT, []);

  const path = getConfigurationPath();
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const mode = (await stat(path)).mode & 0o777;

  expect(value).toEqual({
    version: 0,
    account: TEST_ACCOUNT,
    includedHomes: [],
  });
  expect(mode).toBe(0o600);
  await expect(
    readdir(join(environmentDirectory, 'providers/miot/config')),
  ).resolves.toEqual(['provider.json']);

  const snapshot = requireDefined(await configuration.load());
  const discovery = requireDefined(await configuration.discoverDevices());

  expect(snapshot.selectionSource).toBe('saved');
  expect(snapshot.homes.every(home => !home.included)).toBe(true);
  expect(discovery.homes).toEqual([]);
  expect(discovery.devices).toEqual([]);
});

test('sorts included homes and rejects duplicates before writing', async () => {
  const configuration = createConfiguration();

  await configuration.saveIncludedHomes(TEST_ACCOUNT, [
    {source: 'shared-device', id: 'owner-2'},
    {source: 'owned', id: 'home-2'},
    {source: 'shared-home', id: 'home-3'},
    {source: 'owned', id: 'home-1'},
  ]);

  const value = JSON.parse(await readFile(getConfigurationPath(), 'utf8')) as {
    readonly includedHomes: unknown;
  };

  expect(value.includedHomes).toEqual([
    {source: 'owned', id: 'home-1'},
    {source: 'owned', id: 'home-2'},
    {source: 'shared-home', id: 'home-3'},
    {source: 'shared-device', id: 'owner-2'},
  ]);

  await expect(
    configuration.saveIncludedHomes(TEST_ACCOUNT, [
      {source: 'owned', id: 'home-1'},
      {source: 'owned', id: 'home-1'},
    ]),
  ).rejects.toThrow('Duplicate included home: owned/home-1.');

  const unchangedValue = JSON.parse(
    await readFile(getConfigurationPath(), 'utf8'),
  ) as {readonly includedHomes: unknown};

  expect(unchangedValue.includedHomes).toEqual(value.includedHomes);
});

test('rejects duplicate homes while loading before discovery', async () => {
  let discoveryCount = 0;
  const configuration = createConfiguration({
    discoverDevices: () => {
      discoveryCount++;
      return Promise.resolve(TEST_DISCOVERY);
    },
    beginAuthorization: unexpectedAuthorization,
  });

  await mkdir(join(environmentDirectory, 'providers/miot/config'), {
    recursive: true,
  });
  await writeFile(
    getConfigurationPath(),
    JSON.stringify({
      version: 0,
      account: TEST_ACCOUNT,
      includedHomes: [
        {source: 'owned', id: 'home-1'},
        {source: 'owned', id: 'home-1'},
      ],
    }),
  );

  await expect(configuration.load()).rejects.toThrow(
    'Duplicate configured home: owned/home-1.',
  );
  expect(discoveryCount).toBe(0);
});

test('filters runtime discovery with persisted source and id references', async () => {
  const configuration = createConfiguration();

  await configuration.saveIncludedHomes(TEST_ACCOUNT, [
    {source: 'owned', id: 'home-1'},
  ]);

  const snapshot = requireDefined(await configuration.load());
  const discovery = requireDefined(await configuration.discoverDevices());

  expect(snapshot.homes.map(home => [home.id, home.included])).toEqual([
    ['home-1', true],
    ['home-2', false],
  ]);
  expect(discovery.homes.map(home => home.id)).toEqual(['home-1']);
  expect(discovery.devices.map(device => device.did)).toEqual(['device-1']);
});

test('uses home source and id together as filter identity', async () => {
  const configuration = createConfiguration({
    discoverDevices: () =>
      Promise.resolve({
        account: TEST_ACCOUNT,
        homes: [
          {source: 'owned', id: 'same-id', name: 'Owned', rooms: []},
          {
            source: 'shared-home',
            id: 'same-id',
            name: 'Shared',
            rooms: [],
          },
        ],
        devices: [
          {did: 'owned-device', source: 'owned', homeId: 'same-id'},
          {
            did: 'shared-device',
            source: 'shared-home',
            homeId: 'same-id',
          },
        ],
      }),
    beginAuthorization: unexpectedAuthorization,
  });

  await configuration.saveIncludedHomes(TEST_ACCOUNT, [
    {source: 'shared-home', id: 'same-id'},
  ]);

  const discovery = requireDefined(await configuration.discoverDevices());

  expect(discovery.homes.map(home => home.source)).toEqual(['shared-home']);
  expect(discovery.devices.map(device => device.did)).toEqual([
    'shared-device',
  ]);
});

test('does not apply a selection saved for a different account', async () => {
  const configuration = createConfiguration({
    discoverDevices: () =>
      Promise.resolve({
        ...TEST_DISCOVERY,
        account: {cloudServer: 'cn', userId: 'user-2'},
      }),
    beginAuthorization: unexpectedAuthorization,
  });

  await configuration.saveIncludedHomes(TEST_ACCOUNT, []);

  const snapshot = requireDefined(await configuration.load());
  const discovery = requireDefined(await configuration.discoverDevices());

  expect(snapshot.selectionSource).toBe('account-mismatch');
  expect(snapshot.homes.every(home => home.included)).toBe(true);
  expect(discovery.homes).toHaveLength(TEST_DISCOVERY.homes.length);
  expect(discovery.devices).toHaveLength(TEST_DISCOVERY.devices.length);
});

test('does not reuse a selection when the account identity is unavailable', async () => {
  const account = {cloudServer: 'cn', userId: null} as const;
  const configuration = createConfiguration({
    discoverDevices: () => Promise.resolve({...TEST_DISCOVERY, account}),
    beginAuthorization: unexpectedAuthorization,
  });

  await mkdir(join(environmentDirectory, 'providers/miot/config'), {
    recursive: true,
  });
  await writeFile(
    getConfigurationPath(),
    JSON.stringify({version: 0, account, includedHomes: []}),
  );

  const snapshot = requireDefined(await configuration.load());
  const discovery = requireDefined(await configuration.discoverDevices());

  expect(snapshot.selectionSource).toBe('account-mismatch');
  expect(snapshot.homes.every(home => home.included)).toBe(true);
  expect(discovery.homes).toHaveLength(TEST_DISCOVERY.homes.length);
  expect(discovery.devices).toHaveLength(TEST_DISCOVERY.devices.length);
});

test('refuses to save a selection without an account identity', async () => {
  const configuration = createConfiguration();

  await expect(
    configuration.saveIncludedHomes({cloudServer: 'cn', userId: null}, []),
  ).rejects.toThrow(
    'Cannot save included homes without a stable Xiaomi account identifier.',
  );
  await expect(readFile(getConfigurationPath(), 'utf8')).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test('wraps authorization without exposing its private result', async () => {
  let authorizationWaitCount = 0;
  let authorizationCancelCount = 0;
  const submittedCallbackUrls: string[] = [];
  let discoveryCount = 0;
  const internalAuthorization = {
    url: 'https://example.test/authorize',
    token: 'must-not-leak',
    wait: async (): Promise<void> => {
      authorizationWaitCount++;
    },
    submitCallbackUrl: async (callbackUrl: string): Promise<void> => {
      submittedCallbackUrls.push(callbackUrl);
    },
    cancel: async (): Promise<void> => {
      authorizationCancelCount++;
    },
  };
  const configuration = createConfiguration({
    discoverDevices: () => {
      discoveryCount++;
      return Promise.reject(new Error('Unexpected discovery.'));
    },
    beginAuthorization: () => Promise.resolve(internalAuthorization),
  });
  const authorization = await configuration.beginAuthorization('cn');

  expect(authorization.url).toBe('https://example.test/authorize');
  expect(JSON.stringify(authorization)).not.toContain('must-not-leak');

  const firstCompletion = authorization.wait();
  const secondCompletion = authorization.wait();

  expect(firstCompletion).toBe(secondCompletion);
  await firstCompletion;
  expect(authorizationWaitCount).toBe(1);

  await authorization.submitCallbackUrl(
    'http://localhost/oauth/callback?code=code&state=state',
  );
  expect(submittedCallbackUrls).toEqual([
    'http://localhost/oauth/callback?code=code&state=state',
  ]);

  await authorization.cancel();
  expect(authorizationCancelCount).toBe(1);
  expect(discoveryCount).toBe(0);
});

test('forgets only local authorization', async () => {
  let forgetCount = 0;
  let discoveryCount = 0;
  const configuration = createConfiguration({
    discoverDevices: () => {
      discoveryCount++;
      return Promise.reject(new Error('Unexpected discovery.'));
    },
    forgetAuthorization: () => {
      forgetCount++;
      return Promise.resolve();
    },
  });
  const identityPath = join(
    environmentDirectory,
    'providers',
    'miot',
    'identity',
    'uuid.json',
  );

  await configuration.saveIncludedHomes(TEST_ACCOUNT, [
    {source: 'owned', id: 'home-1'},
  ]);
  await mkdir(dirname(identityPath), {recursive: true});
  await writeFile(identityPath, 'identity');

  await configuration.forgetAuthorization();

  expect(forgetCount).toBe(1);
  expect(discoveryCount).toBe(0);

  await expect(readFile(getConfigurationPath(), 'utf8')).resolves.toContain(
    'home-1',
  );
  await expect(readFile(identityPath, 'utf8')).resolves.toBe('identity');
});

test('rejects provider names that could escape the configuration directory', () => {
  expect(() => createConfiguration(undefined, '../provider')).toThrow(
    'Invalid MIoT provider name: ../provider.',
  );
});

function createConfiguration(
  dependencies: Partial<MiotProviderConfigurationDependencies> = {},
  providerName = 'provider',
): MiotProviderConfiguration {
  return new MiotProviderConfiguration({
    providerName,
    environmentDirectory,
    dependencies: {
      discoverDevices:
        dependencies.discoverDevices ?? (() => Promise.resolve(TEST_DISCOVERY)),
      beginAuthorization:
        dependencies.beginAuthorization ?? unexpectedAuthorization,
      forgetAuthorization:
        dependencies.forgetAuthorization ?? unexpectedForgetAuthorization,
    },
  });
}

function getConfigurationPath(): string {
  return join(
    environmentDirectory,
    'providers',
    'miot',
    'config',
    'provider.json',
  );
}

function unexpectedAuthorization(): Promise<MiotProviderConfigurationAuthorizationDependency> {
  return Promise.reject(new Error('Unexpected authorization.'));
}

function unexpectedForgetAuthorization(): Promise<void> {
  return Promise.reject(new Error('Unexpected authorization forget.'));
}

function requireDefined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new TypeError('Expected a defined test value.');
  }

  return value;
}
