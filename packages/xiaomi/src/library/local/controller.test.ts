import type {BackendClient} from '../backend/index.js';
import {MiotEndpointConnectionTransportUnavailableError} from '../endpoint-connection.js';
import {
  type MiotExecutionRequest,
  MiotInvokeActionRequest,
  MiotSetPropertyRequest,
} from '../miot/index.js';

import type {LocalCertificateManager} from './certificate.js';
import {
  LocalController,
  type LocalControllerDiscovery,
  type LocalControllerOptions,
} from './controller.js';
import type {CentralRoute} from './discovery.js';
import type {
  LocalDeviceInfo,
  LocalMqttClient,
  LocalMqttClientOptions,
} from './mqtt.js';

const DISCOVERY: LocalControllerDiscovery = {
  userId: 'user-1',
  candidates: [{did: 'gateway-1', homeId: 'home-1', homeName: 'Home'}],
};
const ROUTE: CentralRoute = {
  did: 'gateway-1',
  groupId: 'group-1',
  homeName: 'Home',
  address: '192.0.2.1',
  port: 8883,
};
const CERTIFICATE = {
  privateKey: 'private-key',
  certificate: 'certificate',
  caCertificate: 'ca-certificate',
};

test('does not start local control outside the China cloud region', async () => {
  let discoveryCount = 0;
  const dependencies = createDependencies();
  const controller = new LocalController(
    createOptions({
      cloudServer: 'de',
      loadDiscovery: async () => {
        discoveryCount++;
        return DISCOVERY;
      },
    }),
    dependencies,
  );

  controller.start();
  await flushMicrotasks();

  expect(discoveryCount).toBe(0);
  expect(dependencies.clients).toHaveLength(0);
  await expect(
    controller.executeRequest(createRequest('light-1')),
  ).rejects.toBeInstanceOf(MiotEndpointConnectionTransportUnavailableError);
  await controller.dispose();
});

test('routes commands and messages only with the required device capabilities', async () => {
  const dependencies = createDependencies();
  const controller = new LocalController(createOptions(), dependencies);
  const routeChanges: number[] = [];
  controller.addRoutesChangedListener(() => {
    routeChanges.push(routeChanges.length + 1);
  });

  controller.start();
  await waitFor(() => controller.getMessageSource('light-1') !== undefined);

  const [client] = dependencies.clients;
  expect(client?.options).toEqual(
    expect.objectContaining({
      virtualDid: 'virtual-test-uuid',
      gatewayDid: ROUTE.did,
      host: ROUTE.address,
      port: ROUTE.port,
      ca: CERTIFICATE.caCertificate,
      cert: CERTIFICATE.certificate,
      key: CERTIFICATE.privateKey,
    }),
  );
  expect(dependencies.certificateOptions).toEqual(
    expect.objectContaining({
      path: '/provider-certificates/test-uuid/central.json',
      uuid: 'test-uuid',
      userId: 'user-1',
    }),
  );

  const request = createRequest('light-1');
  await expect(controller.executeRequest(request)).resolves.toEqual({code: 0});
  const actionRequest = new MiotInvokeActionRequest(
    {did: 'light-1', siid: 2, aiid: 1},
    [{piid: 8, value: 10}],
  );
  await expect(controller.executeRequest(actionRequest)).resolves.toEqual({
    code: 0,
  });
  expect(client?.requests).toEqual([request, actionRequest]);
  expect(routeChanges.length).toBeGreaterThan(0);

  const offlineRouteChangeCount = routeChanges.length;
  client?.setDevices(
    new Map([
      ['light-1', {online: false, specV2Access: true, pushAvailable: true}],
    ]),
  );
  client?.emitDeviceListChanged();
  await waitFor(
    () =>
      (client?.getDeviceListCount ?? 0) >= 2 &&
      routeChanges.length > offlineRouteChangeCount,
  );

  expect(controller.getMessageSource('light-1')).toBeUndefined();
  await expect(controller.executeRequest(request)).rejects.toBeInstanceOf(
    MiotEndpointConnectionTransportUnavailableError,
  );
  expect(client?.requests).toEqual([request, actionRequest]);

  client?.setDevices(
    new Map([
      ['light-1', {online: true, specV2Access: false, pushAvailable: false}],
    ]),
  );
  client?.emitDeviceListChanged();
  await waitFor(
    () =>
      client?.getDeviceListCount === 3 &&
      controller.getMessageSource('light-1') === undefined,
  );

  expect(controller.getMessageSource('light-1')).toBeUndefined();
  await expect(controller.executeRequest(request)).rejects.toBeInstanceOf(
    MiotEndpointConnectionTransportUnavailableError,
  );

  await controller.dispose();
  expect(client?.disconnectCount).toBe(1);
});

test('drops local routes while disconnected and restores them after reconnect', async () => {
  const dependencies = createDependencies();
  const controller = new LocalController(createOptions(), dependencies);
  controller.start();
  await waitFor(() => controller.getMessageSource('light-1') !== undefined);
  const [client] = dependencies.clients;

  client?.setConnected(false);
  expect(controller.getMessageSource('light-1')).toBeUndefined();
  await expect(
    controller.executeRequest(createRequest('light-1')),
  ).rejects.toBeInstanceOf(MiotEndpointConnectionTransportUnavailableError);

  client?.setConnected(true);
  await waitFor(
    () =>
      client?.getDeviceListCount === 2 &&
      controller.getMessageSource('light-1') !== undefined,
  );
  expect(controller.getMessageSource('light-1')).toBe(client);

  await controller.dispose();
});

test('reloads a device list changed again during an in-flight reload', async () => {
  const dependencies = createDependencies();
  const controller = new LocalController(createOptions(), dependencies);
  controller.start();
  await waitFor(() => controller.getMessageSource('light-1') !== undefined);
  const [client] = dependencies.clients;
  const pendingList = client?.deferNextDeviceList();

  client?.setDevices(new Map());
  client?.emitDeviceListChanged();
  await waitFor(() => (client?.getDeviceListCount ?? 0) >= 2);
  client?.setDevices(
    new Map([
      ['light-1', {online: true, specV2Access: true, pushAvailable: true}],
    ]),
  );
  client?.emitDeviceListChanged();
  pendingList?.resolve(undefined);
  await waitFor(
    () =>
      (client?.getDeviceListCount ?? 0) >= 3 &&
      controller.getMessageSource('light-1') !== undefined,
  );

  expect(controller.getMessageSource('light-1')).toBe(client);
  await controller.dispose();
});

test('retries failed initialization and cancels the retry on disposal', async () => {
  import.meta.jest.useFakeTimers();
  const originalError = console.error;
  console.error = () => undefined;
  let discoveryCount = 0;
  const dependencies = createDependencies();
  const controller = new LocalController(
    createOptions({
      loadDiscovery: async () => {
        discoveryCount++;

        if (discoveryCount === 1) {
          throw new Error('Temporary discovery failure.');
        }

        return DISCOVERY;
      },
    }),
    dependencies,
  );

  try {
    controller.start();
    await flushMicrotasks();
    expect(discoveryCount).toBe(1);
    expect(import.meta.jest.getTimerCount()).toBe(1);

    await import.meta.jest.runOnlyPendingTimersAsync();
    await waitFor(() => controller.getMessageSource('light-1') !== undefined);
    expect(discoveryCount).toBe(2);
    expect(import.meta.jest.getTimerCount()).toBe(1);

    await controller.dispose();
    expect(import.meta.jest.getTimerCount()).toBe(0);
  } finally {
    await controller.dispose();
    console.error = originalError;
    import.meta.jest.useRealTimers();
  }
});

test('releases route ownership and reports MQTT disconnect failures', async () => {
  const dependencies = createDependencies();
  const controller = new LocalController(createOptions(), dependencies);
  controller.start();
  await waitFor(() => controller.getMessageSource('light-1') !== undefined);
  const [client] = dependencies.clients;

  if (client === undefined) {
    throw new Error('Missing local MQTT test client.');
  }

  client.disconnectError = new Error('Test local MQTT disconnect failure.');
  const disposal = controller.dispose();
  const result = await disposal.then(
    () => ({status: 'fulfilled' as const}),
    error => ({status: 'rejected' as const, error}),
  );

  expect({result, disconnectCount: client.disconnectCount}).toEqual({
    result: {status: 'rejected', error: client.disconnectError},
    disconnectCount: 1,
  });
  expect(controller.connected).toBe(false);
  expect(controller.getMessageSource('light-1')).toBeUndefined();
  await expect(controller.dispose()).resolves.toBeUndefined();
});

function createOptions(
  overrides: Partial<{
    readonly cloudServer: 'cn' | 'de';
    readonly loadDiscovery: () => Promise<LocalControllerDiscovery>;
  }> = {},
): LocalControllerOptions {
  return {
    session: {
      uuid: 'test-uuid',
      cloudServer: overrides.cloudServer ?? ('cn' as const),
    },
    backendClient: {
      getCentralCertificate: async () => CERTIFICATE.certificate,
    } as unknown as BackendClient,
    certificateDirectory: '/provider-certificates',
    loadDiscovery: overrides.loadDiscovery ?? (async () => DISCOVERY),
  };
}

function createDependencies(): LocalControllerTestDependencies {
  const clients: TestLocalMqttClient[] = [];
  let certificateOptions:
    ConstructorParameters<typeof LocalCertificateManager>[0] | undefined;

  return {
    clients,
    get certificateOptions() {
      return certificateOptions;
    },
    getVirtualDid: (uuid: string) => `virtual-${uuid}`,
    createCertificateManager: (
      options: ConstructorParameters<typeof LocalCertificateManager>[0],
    ) => {
      certificateOptions = options;
      return {ensureCertificate: async () => CERTIFICATE};
    },
    discoverCentralRoutes: async () => [ROUTE],
    createMqttClient: (options: LocalMqttClientOptions) => {
      const client = new TestLocalMqttClient(options);
      clients.push(client);
      return client as unknown as LocalMqttClient;
    },
  };
}

class TestLocalMqttClient {
  connected = false;

  disconnectCount = 0;

  disconnectError: Error | undefined;

  getDeviceListCount = 0;

  readonly requests: MiotExecutionRequest[] = [];

  private devices: ReadonlyMap<string, LocalDeviceInfo> = new Map([
    ['light-1', {online: true, specV2Access: true, pushAvailable: true}],
  ]);

  private readonly connectionStateListeners = new Set<
    (connected: boolean) => void
  >();

  private readonly deviceListChangedListeners = new Set<() => void>();

  private nextDeviceList: Deferred<void> | undefined;

  constructor(readonly options: LocalMqttClientOptions) {}

  async connect(): Promise<void> {
    this.setConnected(true);
  }

  async disconnect(): Promise<void> {
    this.disconnectCount++;
    this.setConnected(false);

    if (this.disconnectError !== undefined) {
      throw this.disconnectError;
    }
  }

  async getDeviceList(): Promise<ReadonlyMap<string, LocalDeviceInfo>> {
    this.getDeviceListCount++;
    const devices = this.devices;
    const deferred = this.nextDeviceList;
    this.nextDeviceList = undefined;
    await deferred?.promise;
    return devices;
  }

  async executeRequest(
    request: MiotExecutionRequest,
  ): Promise<{readonly code: number}> {
    this.requests.push(request);
    return {code: 0};
  }

  addConnectionStateListener(
    listener: (connected: boolean) => void,
  ): () => void {
    this.connectionStateListeners.add(listener);
    return () => {
      this.connectionStateListeners.delete(listener);
    };
  }

  addDeviceListChangedListener(listener: () => void): () => void {
    this.deviceListChangedListeners.add(listener);
    return () => {
      this.deviceListChangedListeners.delete(listener);
    };
  }

  setConnected(connected: boolean): void {
    if (this.connected === connected) {
      return;
    }

    this.connected = connected;

    for (const listener of this.connectionStateListeners) {
      listener(connected);
    }
  }

  setDevices(devices: ReadonlyMap<string, LocalDeviceInfo>): void {
    this.devices = devices;
  }

  emitDeviceListChanged(): void {
    for (const listener of this.deviceListChangedListeners) {
      listener();
    }
  }

  deferNextDeviceList(): Deferred<void> {
    const deferred = createDeferred<void>();
    this.nextDeviceList = deferred;
    return deferred;
  }
}

type LocalControllerTestDependencies = {
  readonly clients: TestLocalMqttClient[];
  readonly certificateOptions:
    ConstructorParameters<typeof LocalCertificateManager>[0] | undefined;
  readonly getVirtualDid: (uuid: string) => string;
  readonly createCertificateManager: (
    options: ConstructorParameters<typeof LocalCertificateManager>[0],
  ) => Pick<LocalCertificateManager, 'ensureCertificate'>;
  readonly discoverCentralRoutes: () => Promise<readonly CentralRoute[]>;
  readonly createMqttClient: (
    options: LocalMqttClientOptions,
  ) => LocalMqttClient;
};

function createRequest(did: string): MiotSetPropertyRequest {
  return new MiotSetPropertyRequest({did, siid: 2, piid: 1}, true);
}

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });

  return {promise, resolve};
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (condition()) {
      return;
    }

    await flushMicrotasks();
  }

  throw new Error('Condition was not met.');
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
