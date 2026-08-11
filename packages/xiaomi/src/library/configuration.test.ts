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
import {join} from 'node:path';

import {
  MiotProviderConfiguration,
  type MiotProviderConfigurationAuthorizationDependency,
  type MiotProviderConfigurationDependencies,
  type MiotProviderConfigurationDiscovery,
} from './configuration.js';

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
  const signal = new AbortController().signal;

  await expect(configuration.load(signal)).resolves.toEqual({
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

  const discovery = requireDefined(await configuration.discoverDevices(signal));

  expect(discovery).toEqual(TEST_DISCOVERY);
  expect(JSON.stringify(discovery)).not.toContain('must-not-leak');
});

test('returns undefined when authorization is missing', async () => {
  const configuration = createConfiguration({
    discoverDevices: () => Promise.resolve(undefined),
    beginAuthorization: unexpectedAuthorization,
  });
  const signal = new AbortController().signal;

  await expect(configuration.load(signal)).resolves.toBeUndefined();
  await expect(configuration.discoverDevices(signal)).resolves.toBeUndefined();
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

  const signal = new AbortController().signal;
  const snapshot = requireDefined(await configuration.load(signal));
  const discovery = requireDefined(await configuration.discoverDevices(signal));

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

  await expect(
    configuration.load(new AbortController().signal),
  ).rejects.toThrow('Duplicate configured home: owned/home-1.');
  expect(discoveryCount).toBe(0);
});

test('filters runtime discovery with persisted source and id references', async () => {
  const configuration = createConfiguration();

  await configuration.saveIncludedHomes(TEST_ACCOUNT, [
    {source: 'owned', id: 'home-1'},
  ]);

  const signal = new AbortController().signal;
  const snapshot = requireDefined(await configuration.load(signal));
  const discovery = requireDefined(await configuration.discoverDevices(signal));

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

  const discovery = requireDefined(
    await configuration.discoverDevices(new AbortController().signal),
  );

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

  const signal = new AbortController().signal;
  const snapshot = requireDefined(await configuration.load(signal));
  const discovery = requireDefined(await configuration.discoverDevices(signal));

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

  const signal = new AbortController().signal;
  const snapshot = requireDefined(await configuration.load(signal));
  const discovery = requireDefined(await configuration.discoverDevices(signal));

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
  let discoveryCount = 0;
  const internalAuthorization = {
    url: 'https://example.test/authorize',
    token: 'must-not-leak',
    wait: async (): Promise<void> => {
      authorizationWaitCount++;
    },
  };
  const configuration = createConfiguration({
    discoverDevices: () => {
      discoveryCount++;
      return Promise.reject(new Error('Unexpected discovery.'));
    },
    beginAuthorization: () => Promise.resolve(internalAuthorization),
  });
  const signal = new AbortController().signal;
  const authorization = await configuration.beginAuthorization('cn', signal);

  expect(authorization.url).toBe('https://example.test/authorize');
  expect(JSON.stringify(authorization)).not.toContain('must-not-leak');

  const firstCompletion = authorization.wait();
  const secondCompletion = authorization.wait();

  expect(firstCompletion).toBe(secondCompletion);
  await firstCompletion;
  expect(authorizationWaitCount).toBe(1);
  expect(discoveryCount).toBe(0);
});

test('rejects provider names that could escape the configuration directory', () => {
  expect(() => createConfiguration(undefined, '../provider')).toThrow(
    'Invalid MIoT provider name: ../provider.',
  );
});

function createConfiguration(
  dependencies: MiotProviderConfigurationDependencies = {
    discoverDevices: () => Promise.resolve(TEST_DISCOVERY),
    beginAuthorization: unexpectedAuthorization,
  },
  providerName = 'provider',
): MiotProviderConfiguration {
  return new MiotProviderConfiguration({
    providerName,
    environmentDirectory,
    dependencies,
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

function requireDefined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new TypeError('Expected a defined test value.');
  }

  return value;
}
