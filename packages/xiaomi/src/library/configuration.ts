import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

import * as x from 'x-value';

import {
  type BackendDevice,
  type BackendHome,
  type BackendHomeSource,
  CLOUD_SERVERS,
  type CloudServer,
} from './backend/index.js';
import {writePrivateJsonFile} from './storage.js';

const HomeSourceValue = x.union([
  x.literal('owned'),
  x.literal('shared-home'),
  x.literal('shared-device'),
]);

const CloudServerValue = x.string.refined<never, CloudServer>(value => {
  if (!isCloudServer(value)) {
    throw new TypeError(`Unknown Xiaomi cloud server: ${value}.`);
  }

  return value;
});

const AccountValue = x
  .object({
    cloudServer: CloudServerValue,
    userId: x.union([x.string, x.null]),
  })
  .exact();

const HomeReferenceValue = x
  .object({
    source: HomeSourceValue,
    id: x.string,
  })
  .exact();

const ConfigurationFileValue = x
  .object({
    version: x.literal(0),
    account: AccountValue,
    includedHomes: x.array(HomeReferenceValue),
  })
  .exact();

const BackendRoomValue = x.object({
  id: x.string,
  name: x.string,
});

const BackendHomeValue = x.object({
  id: x.string,
  name: x.string,
  source: HomeSourceValue,
  rooms: x.array(BackendRoomValue),
});

const BackendDeviceValue = x.object({
  did: x.string,
  name: x.string.optional(),
  model: x.string.optional(),
  specType: x.string.optional(),
  online: x.boolean.optional(),
  parentDid: x.string.optional(),
  firmwareVersion: x.string.optional(),
  source: HomeSourceValue.optional(),
  homeId: x.string.optional(),
  homeName: x.string.optional(),
  roomId: x.string.optional(),
  roomName: x.string.optional(),
});

export class MiotProviderConfiguration {
  private readonly path: string;

  private readonly dependencies: MiotProviderConfigurationDependencies;

  constructor(options: MiotProviderConfigurationOptions) {
    const {providerName, environmentDirectory, dependencies} = options;

    assertProviderName(providerName);
    this.path = join(
      environmentDirectory,
      'providers',
      'miot',
      'config',
      `${providerName}.json`,
    );
    this.dependencies = dependencies;
  }

  async load(
    signal: AbortSignal,
  ): Promise<MiotProviderConfigurationSnapshot | undefined> {
    const state = await this.loadState(signal);

    if (state === undefined) {
      return undefined;
    }

    const {account, homes} = state.discovery;

    return {
      account,
      selectionSource: state.selectionSource,
      homes: homes.map(home => ({
        source: home.source,
        id: home.id,
        name: home.name,
        included:
          state.includedHomeKeySet === undefined ||
          state.includedHomeKeySet.has(getHomeKey(home)),
      })),
    };
  }

  async discoverDevices(
    signal: AbortSignal,
  ): Promise<MiotProviderFilteredDiscovery | undefined> {
    const state = await this.loadState(signal);

    if (state === undefined) {
      return undefined;
    }

    const {account, homes, devices} = state.discovery;
    const {includedHomeKeySet} = state;

    if (includedHomeKeySet === undefined) {
      return {account, homes, devices};
    }

    return {
      account,
      homes: homes.filter(home => includedHomeKeySet.has(getHomeKey(home))),
      devices: devices.filter(device => {
        if (device.source === undefined || device.homeId === undefined) {
          return false;
        }

        return includedHomeKeySet.has(
          getHomeKey({source: device.source, id: device.homeId}),
        );
      }),
    };
  }

  async beginAuthorization(
    cloudServer: CloudServer,
    signal: AbortSignal,
  ): Promise<MiotProviderConfigurationAuthorization> {
    const validatedCloudServer = CloudServerValue.satisfies(cloudServer);

    signal.throwIfAborted();

    const authorization = await this.dependencies.beginAuthorization(
      validatedCloudServer,
      signal,
    );
    const url = x.string.satisfies(authorization.url);
    let completion: Promise<void> | undefined;

    signal.throwIfAborted();

    return {
      url,
      wait: () => {
        completion ??= authorization.wait();
        return completion;
      },
    };
  }

  async saveIncludedHomes(
    account: MiotProviderAccount,
    includedHomes: readonly MiotProviderHomeReference[],
  ): Promise<void> {
    const validatedAccount = AccountValue.satisfies(account);
    const validatedHomes = includedHomes.map(home =>
      HomeReferenceValue.satisfies(home),
    );

    if (validatedAccount.userId === null) {
      throw new Error(
        'Cannot save included homes without a stable Xiaomi account identifier.',
      );
    }

    assertUniqueHomeReferences(validatedHomes, 'included home');
    validatedHomes.sort(compareHomeReferences);

    await writePrivateJsonFile(this.path, {
      version: 0,
      account: validatedAccount,
      includedHomes: validatedHomes,
    } satisfies ConfigurationFile);
  }

  private async loadState(
    signal: AbortSignal,
  ): Promise<LoadedState | undefined> {
    const configuration = await this.readConfiguration(signal);

    signal.throwIfAborted();

    const discovered = await this.dependencies.discoverDevices(signal);

    if (discovered === undefined) {
      return undefined;
    }

    const discovery = sanitizeDiscovery(discovered);

    signal.throwIfAborted();

    if (configuration === undefined) {
      return {
        discovery,
        selectionSource: 'default',
        includedHomeKeySet: undefined,
      };
    } else if (!accountsEqual(configuration.account, discovery.account)) {
      return {
        discovery,
        selectionSource: 'account-mismatch',
        includedHomeKeySet: undefined,
      };
    }

    return {
      discovery,
      selectionSource: 'saved',
      includedHomeKeySet: new Set(configuration.includedHomes.map(getHomeKey)),
    };
  }

  private async readConfiguration(
    signal: AbortSignal,
  ): Promise<ConfigurationFile | undefined> {
    let source: string;

    try {
      source = await readFile(this.path, {encoding: 'utf8', signal});
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return undefined;
      }

      throw error;
    }

    const configuration = ConfigurationFileValue.satisfies(
      JSON.parse(source) as unknown,
    );

    assertUniqueHomeReferences(configuration.includedHomes, 'configured home');
    return configuration;
  }
}

export type MiotProviderConfigurationOptions = {
  readonly providerName: string;
  readonly environmentDirectory: string;
  readonly dependencies: MiotProviderConfigurationDependencies;
};

export type MiotProviderConfigurationDependencies = {
  discoverDevices(
    signal: AbortSignal,
  ): Promise<MiotProviderConfigurationDiscovery | undefined>;
  beginAuthorization(
    cloudServer: CloudServer,
    signal: AbortSignal,
  ): Promise<MiotProviderConfigurationAuthorizationDependency>;
};

export type MiotProviderConfigurationDiscovery = {
  readonly account: MiotProviderAccount;
  readonly homes: readonly BackendHome[];
  readonly devices: readonly BackendDevice[];
};

export type MiotProviderFilteredDiscovery = MiotProviderConfigurationDiscovery;

export type MiotProviderConfigurationAuthorizationDependency = {
  readonly url: string;
  wait(): Promise<void>;
};

export type MiotProviderConfigurationAuthorization = {
  readonly url: string;
  wait(): Promise<void>;
};

export type MiotProviderConfigurationSnapshot = {
  readonly account: MiotProviderAccount;
  readonly selectionSource: MiotProviderHomeSelectionSource;
  readonly homes: readonly MiotProviderHomeItem[];
};

export type MiotProviderHomeSelectionSource =
  'default' | 'saved' | 'account-mismatch';

export type MiotProviderAccount = {
  readonly cloudServer: CloudServer;
  readonly userId: string | null;
};

export type MiotProviderHomeReference = {
  readonly source: BackendHomeSource;
  readonly id: string;
};

export type MiotProviderHomeItem = MiotProviderHomeReference & {
  readonly name: string;
  readonly included: boolean;
};

type ConfigurationFile = {
  readonly version: 0;
  readonly account: MiotProviderAccount;
  readonly includedHomes: readonly MiotProviderHomeReference[];
};

type LoadedState = {
  readonly discovery: MiotProviderConfigurationDiscovery;
  readonly selectionSource: MiotProviderHomeSelectionSource;
  readonly includedHomeKeySet: ReadonlySet<string> | undefined;
};

function sanitizeDiscovery(
  discovery: MiotProviderConfigurationDiscovery,
): MiotProviderConfigurationDiscovery {
  const account = AccountValue.sanitize(discovery.account);
  const homes = discovery.homes.map(home => BackendHomeValue.sanitize(home));
  const devices = discovery.devices.map(device =>
    BackendDeviceValue.sanitize(device),
  );

  assertUniqueHomeReferences(homes, 'discovered home');
  assertUniqueDevices(devices);

  return {account, homes, devices};
}

function assertUniqueHomeReferences(
  homes: readonly MiotProviderHomeReference[],
  description: string,
): void {
  const keySet = new Set<string>();

  for (const home of homes) {
    const key = getHomeKey(home);

    if (keySet.has(key)) {
      throw new TypeError(
        `Duplicate ${description}: ${home.source}/${home.id}.`,
      );
    }

    keySet.add(key);
  }
}

function assertUniqueDevices(devices: readonly BackendDevice[]): void {
  const didSet = new Set<string>();

  for (const device of devices) {
    if (didSet.has(device.did)) {
      throw new TypeError(`Duplicate discovered device: ${device.did}.`);
    }

    didSet.add(device.did);
  }
}

function getHomeKey(home: MiotProviderHomeReference): string {
  return JSON.stringify([home.source, home.id]);
}

function compareHomeReferences(
  left: MiotProviderHomeReference,
  right: MiotProviderHomeReference,
): number {
  return (
    HOME_SOURCE_ORDER.indexOf(left.source) -
      HOME_SOURCE_ORDER.indexOf(right.source) ||
    compareStrings(left.id, right.id)
  );
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  } else if (left > right) {
    return 1;
  }

  return 0;
}

function accountsEqual(
  left: MiotProviderAccount,
  right: MiotProviderAccount,
): boolean {
  if (left.userId === null || right.userId === null) {
    return false;
  }

  return left.cloudServer === right.cloudServer && left.userId === right.userId;
}

function assertProviderName(name: string): void {
  if (
    name === '' ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new TypeError(`Invalid MIoT provider name: ${name}.`);
  }
}

function isCloudServer(value: string): value is CloudServer {
  return CLOUD_SERVERS.some(cloudServer => cloudServer === value);
}

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return error.code === 'ENOENT';
}

const HOME_SOURCE_ORDER = [
  'owned',
  'shared-home',
  'shared-device',
] as const satisfies readonly BackendHomeSource[];
