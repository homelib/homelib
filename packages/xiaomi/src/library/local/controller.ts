import {join} from 'node:path';

import type {BackendClient, CloudServer} from '../backend/index.js';
import {
  MiotEndpointConnectionTransport,
  MiotEndpointConnectionTransportUnavailableError,
} from '../endpoint-connection.js';
import type {
  MiotExecutionRequest,
  MiotExecutionResult,
  MiotProperty,
} from '../miot/index.js';

import {
  type LocalCertificate,
  LocalCertificateManager,
  getVirtualDid,
} from './certificate.js';
import {
  type CentralGatewayCandidate,
  type CentralRoute,
  discoverCentralRoutes,
} from './discovery.js';
import {
  type LocalDeviceInfo,
  LocalMqttClient,
  type LocalMqttClientOptions,
  type LocalPropertyResult,
} from './mqtt.js';

const ROUTE_REFRESH_INTERVAL = 10 * 60_000;
const INITIAL_RETRY_INTERVAL = 5_000;
const MAXIMUM_RETRY_INTERVAL = 60_000;
const DEVICE_LIST_RETRY_INTERVAL = 5_000;
const CERTIFICATE_FILE_NAME = 'central.json';

export class LocalController extends MiotEndpointConnectionTransport {
  private readonly virtualDid: string;

  private readonly routeRuntimeMap = new Map<string, LocalRouteRuntime>();

  private readonly routesChangedListenerSet =
    new Set<LocalRoutesChangedListener>();

  private active = false;

  private generation = 0;

  private retryInterval = INITIAL_RETRY_INTERVAL;

  private refreshPromise: Promise<void> | undefined;

  private refreshTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly options: LocalControllerOptions,
    private readonly dependencies: LocalControllerDependencies = DEFAULT_DEPENDENCIES,
  ) {
    super();
    this.virtualDid = dependencies.getVirtualDid(options.session.uuid);
  }

  get connected(): boolean {
    for (const runtime of this.routeRuntimeMap.values()) {
      if (runtime.client.connected) {
        return true;
      }
    }

    return false;
  }

  async connect(): Promise<void> {
    this.start();

    const refreshPromise = this.refreshPromise;

    if (refreshPromise !== undefined) {
      await refreshPromise;
    }

    if (!this.connected) {
      throw new MiotEndpointConnectionTransportUnavailableError(
        'No local MQTT gateway is connected.',
      );
    }
  }

  start(): void {
    if (this.active || this.options.session.cloudServer !== 'cn') {
      return;
    }

    this.active = true;
    this.retryInterval = INITIAL_RETRY_INTERVAL;
    this.startRefresh(this.generation);
  }

  async dispose(): Promise<void> {
    if (!this.active && this.routeRuntimeMap.size === 0) {
      return;
    }

    this.active = false;
    this.generation++;
    this.clearRefreshTimeout();
    const runtimes = [...this.routeRuntimeMap.values()];
    this.routeRuntimeMap.clear();
    this.notifyRoutesChanged();
    const runtimeDisposals = runtimes.map(runtime =>
      this.disposeRuntime(runtime),
    );
    await this.refreshPromise?.catch(() => undefined);
    const results = await Promise.allSettled(runtimeDisposals);
    throwRejectedResults(results, 'Failed to dispose local MQTT routes.');
  }

  async disconnect(): Promise<void> {
    await this.dispose();
  }

  addRoutesChangedListener(listener: LocalRoutesChangedListener): () => void {
    this.routesChangedListenerSet.add(listener);

    return () => {
      this.routesChangedListenerSet.delete(listener);
    };
  }

  getMessageSource(did: string): LocalMqttClient | undefined {
    for (const runtime of this.routeRuntimeMap.values()) {
      const info = runtime.deviceInfoMap.get(did);

      if (
        runtime.client.connected &&
        info !== undefined &&
        info.online &&
        info.pushAvailable
      ) {
        return runtime.client;
      }
    }

    return undefined;
  }

  async getProperties(
    properties: readonly MiotProperty[],
  ): Promise<readonly LocalPropertyResult[]> {
    const routes = properties.map(property => ({
      property,
      client: this.getRequestSource(property.did),
    }));

    if (routes.some(route => route.client === undefined)) {
      throw new MiotEndpointConnectionTransportUnavailableError(
        'No local MQTT route is available for the requested MIoT properties.',
      );
    }

    const results: LocalPropertyResult[] = [];

    for (const {property, client} of routes) {
      if (client === undefined) {
        throw new Error('Local MQTT property route disappeared.');
      }

      results.push(...(await client.getProperties([property])));
    }

    return results;
  }

  async getDeviceOnline(did: string): Promise<boolean> {
    for (const runtime of this.routeRuntimeMap.values()) {
      const info = runtime.deviceInfoMap.get(did);

      if (runtime.client.connected && info !== undefined) {
        return info.online;
      }
    }

    throw new MiotEndpointConnectionTransportUnavailableError(
      `No local MQTT state route is available for MIoT device ${did}.`,
    );
  }

  override async executeRequest(
    request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult> {
    const did = request.property.did;
    const client = this.getRequestSource(did);

    if (client !== undefined) {
      return client.executeRequest(request);
    }

    throw new MiotEndpointConnectionTransportUnavailableError(
      `No local MQTT route is available for MIoT device ${did}.`,
    );
  }

  private startRefresh(generation: number): void {
    if (!this.isActiveGeneration(generation)) {
      return;
    }

    const refreshPromise = this.refresh(generation);
    this.refreshPromise = refreshPromise;
    void refreshPromise.then(
      () => {
        this.completeRefresh(refreshPromise, generation, undefined);
      },
      error => {
        this.completeRefresh(refreshPromise, generation, error);
      },
    );
  }

  private completeRefresh(
    refreshPromise: Promise<void>,
    generation: number,
    error: unknown,
  ): void {
    if (this.refreshPromise === refreshPromise) {
      this.refreshPromise = undefined;
    }

    if (!this.isActiveGeneration(generation)) {
      return;
    }

    let delay = ROUTE_REFRESH_INTERVAL;

    if (error === undefined) {
      this.retryInterval = INITIAL_RETRY_INTERVAL;
    } else {
      console.error(error);
      delay = this.retryInterval;
      this.retryInterval = Math.min(
        this.retryInterval * 2,
        MAXIMUM_RETRY_INTERVAL,
      );
    }

    this.scheduleRefresh(generation, delay);
  }

  private scheduleRefresh(generation: number, delay: number): void {
    this.clearRefreshTimeout();
    const timeout = setTimeout(() => {
      if (this.refreshTimeout === timeout) {
        this.refreshTimeout = undefined;
      }

      this.startRefresh(generation);
    }, delay);
    timeout.unref?.();
    this.refreshTimeout = timeout;
  }

  private async refresh(generation: number): Promise<void> {
    const discovery = await this.options.loadDiscovery();
    this.assertActiveGeneration(generation);

    if (discovery.userId === undefined || discovery.candidates.length === 0) {
      await this.reconcileRoutes([], undefined, generation);
      return;
    }

    const certificateManager = this.dependencies.createCertificateManager({
      path: join(
        this.options.certificateDirectory,
        this.options.session.uuid,
        CERTIFICATE_FILE_NAME,
      ),
      uuid: this.options.session.uuid,
      userId: discovery.userId,
      getCertificate: request =>
        this.options.backendClient.getCentralCertificate(request),
    });
    const certificate = await certificateManager.ensureCertificate();
    this.assertActiveGeneration(generation);
    const routes = await this.dependencies.discoverCentralRoutes({
      candidates: discovery.candidates,
      userId: discovery.userId,
      virtualDid: this.virtualDid,
    });
    this.assertActiveGeneration(generation);

    if (routes.length === 0 && this.routeRuntimeMap.size > 0) {
      throw new Error(
        'Local MQTT discovery temporarily returned no existing routes.',
      );
    }

    await this.reconcileRoutes(routes, certificate, generation);
  }

  private async reconcileRoutes(
    routes: readonly CentralRoute[],
    certificate: LocalCertificate | undefined,
    generation: number,
  ): Promise<void> {
    const routeMap = new Map<string, CentralRoute>();

    for (const route of routes) {
      routeMap.set(getRouteKey(route), route);
    }

    const obsoleteRuntimes: LocalRouteRuntime[] = [];

    for (const [key, runtime] of this.routeRuntimeMap) {
      const route = routeMap.get(key);

      if (
        route !== undefined &&
        certificate !== undefined &&
        runtime.certificate === certificate.certificate &&
        areRoutesEqual(runtime.route, route)
      ) {
        routeMap.delete(key);
        continue;
      }

      this.routeRuntimeMap.delete(key);
      obsoleteRuntimes.push(runtime);
    }

    if (obsoleteRuntimes.length > 0) {
      this.notifyRoutesChanged();
      await Promise.allSettled(
        obsoleteRuntimes.map(runtime => this.disposeRuntime(runtime)),
      );
    }

    this.assertActiveGeneration(generation);

    if (routeMap.size === 0) {
      return;
    }

    if (certificate === undefined) {
      throw new Error(
        'Cannot connect local MQTT routes without a certificate.',
      );
    }

    const outcomes = await Promise.allSettled(
      [...routeMap.values()].map(route =>
        this.addRoute(route, certificate, generation),
      ),
    );
    const errors = outcomes
      .filter(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected',
      )
      .map(outcome => outcome.reason as unknown);

    if (errors.length > 0) {
      throw new AggregateError(errors, 'Failed to connect local MQTT routes.');
    }
  }

  private async addRoute(
    route: CentralRoute,
    certificate: LocalCertificate,
    generation: number,
  ): Promise<void> {
    const client = this.dependencies.createMqttClient({
      virtualDid: this.virtualDid,
      gatewayDid: route.did,
      host: route.address,
      port: route.port,
      ca: certificate.caCertificate,
      cert: certificate.certificate,
      key: certificate.privateKey,
    });
    const runtime: LocalRouteRuntime = {
      route,
      client,
      certificate: certificate.certificate,
      deviceInfoMap: new Map(),
      deviceListRefreshRequested: false,
      deviceListRetryTimeout: undefined,
      initializing: true,
      disposed: false,
      removeConnectionStateListener: () => undefined,
      removeDeviceListChangedListener: () => undefined,
    };
    runtime.removeConnectionStateListener = client.addConnectionStateListener(
      connected => {
        this.handleConnectionState(runtime, connected);
      },
    );
    runtime.removeDeviceListChangedListener =
      client.addDeviceListChangedListener(() => {
        this.startDeviceListRefresh(runtime);
      });
    const key = getRouteKey(route);
    this.routeRuntimeMap.set(key, runtime);

    try {
      await client.connect();
      this.assertCurrentRuntime(key, runtime, generation);
      await this.refreshDeviceList(runtime);
      this.assertCurrentRuntime(key, runtime, generation);
      runtime.initializing = false;
      this.notifyRoutesChanged();
    } catch (error) {
      if (this.routeRuntimeMap.get(key) === runtime) {
        this.routeRuntimeMap.delete(key);
        this.notifyRoutesChanged();
      }

      await this.disposeRuntime(runtime);
      throw error;
    }
  }

  private handleConnectionState(
    runtime: LocalRouteRuntime,
    connected: boolean,
  ): void {
    if (!this.isCurrentRuntime(runtime)) {
      return;
    }

    if (connected) {
      if (!runtime.initializing) {
        this.startDeviceListRefresh(runtime);
      }

      return;
    }

    runtime.deviceInfoMap = new Map();
    this.notifyRoutesChanged();
  }

  private startDeviceListRefresh(runtime: LocalRouteRuntime): void {
    void this.refreshDeviceList(runtime).catch(error => {
      if (this.isCurrentRuntime(runtime)) {
        console.error(error);
        this.scheduleDeviceListRefresh(runtime);
      }
    });
  }

  private scheduleDeviceListRefresh(runtime: LocalRouteRuntime): void {
    if (runtime.deviceListRetryTimeout !== undefined) {
      return;
    }

    const timeout = setTimeout(() => {
      if (runtime.deviceListRetryTimeout === timeout) {
        runtime.deviceListRetryTimeout = undefined;
      }

      if (this.isCurrentRuntime(runtime)) {
        this.startDeviceListRefresh(runtime);
      }
    }, DEVICE_LIST_RETRY_INTERVAL);
    timeout.unref?.();
    runtime.deviceListRetryTimeout = timeout;
  }

  private async refreshDeviceList(runtime: LocalRouteRuntime): Promise<void> {
    runtime.deviceListRefreshRequested = true;
    let refreshPromise = runtime.deviceListRefreshPromise;

    if (refreshPromise === undefined) {
      const newRefreshPromise = this.drainDeviceListRefresh(runtime);
      refreshPromise = newRefreshPromise;
      runtime.deviceListRefreshPromise = newRefreshPromise;
      const complete = (): void => {
        if (runtime.deviceListRefreshPromise !== newRefreshPromise) {
          return;
        }

        runtime.deviceListRefreshPromise = undefined;

        if (
          runtime.deviceListRefreshRequested &&
          this.isCurrentRuntime(runtime)
        ) {
          this.startDeviceListRefresh(runtime);
        }
      };
      void newRefreshPromise.then(complete, complete);
    }

    await refreshPromise;
  }

  private async drainDeviceListRefresh(
    runtime: LocalRouteRuntime,
  ): Promise<void> {
    while (
      runtime.deviceListRefreshRequested &&
      this.isCurrentRuntime(runtime)
    ) {
      runtime.deviceListRefreshRequested = false;
      await this.loadDeviceList(runtime);
    }
  }

  private async loadDeviceList(runtime: LocalRouteRuntime): Promise<void> {
    const deviceInfoMap = await runtime.client.getDeviceList();

    if (!this.isCurrentRuntime(runtime)) {
      return;
    }

    runtime.deviceInfoMap = deviceInfoMap;

    if (runtime.deviceListRetryTimeout !== undefined) {
      clearTimeout(runtime.deviceListRetryTimeout);
      runtime.deviceListRetryTimeout = undefined;
    }

    this.notifyRoutesChanged();
  }

  private async disposeRuntime(runtime: LocalRouteRuntime): Promise<void> {
    if (runtime.disposed) {
      return;
    }

    runtime.disposed = true;

    if (runtime.deviceListRetryTimeout !== undefined) {
      clearTimeout(runtime.deviceListRetryTimeout);
      runtime.deviceListRetryTimeout = undefined;
    }

    runtime.removeConnectionStateListener();
    runtime.removeDeviceListChangedListener();
    const results = await Promise.allSettled([
      Promise.resolve().then(() => runtime.client.disconnect()),
      runtime.deviceListRefreshPromise ?? Promise.resolve(),
    ]);
    throwRejectedResults(results, 'Failed to dispose a local MQTT route.');
  }

  private isCurrentRuntime(runtime: LocalRouteRuntime): boolean {
    return (
      this.active &&
      !runtime.disposed &&
      this.routeRuntimeMap.get(getRouteKey(runtime.route)) === runtime
    );
  }

  private assertCurrentRuntime(
    key: string,
    runtime: LocalRouteRuntime,
    generation: number,
  ): void {
    this.assertActiveGeneration(generation);

    if (this.routeRuntimeMap.get(key) !== runtime || runtime.disposed) {
      throw new Error('Local MQTT route was replaced during initialization.');
    }
  }

  private isActiveGeneration(generation: number): boolean {
    return this.active && this.generation === generation;
  }

  private assertActiveGeneration(generation: number): void {
    if (!this.isActiveGeneration(generation)) {
      throw new Error('Local MQTT controller operation was cancelled.');
    }
  }

  private clearRefreshTimeout(): void {
    if (this.refreshTimeout === undefined) {
      return;
    }

    clearTimeout(this.refreshTimeout);
    this.refreshTimeout = undefined;
  }

  private notifyRoutesChanged(): void {
    for (const listener of this.routesChangedListenerSet) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }
  }

  private getRequestSource(did: string): LocalMqttClient | undefined {
    for (const runtime of this.routeRuntimeMap.values()) {
      const info = runtime.deviceInfoMap.get(did);

      if (
        runtime.client.connected &&
        info !== undefined &&
        info.online &&
        info.specV2Access
      ) {
        return runtime.client;
      }
    }

    return undefined;
  }
}

export type LocalControllerOptions = {
  readonly session: {
    readonly uuid: string;
    readonly cloudServer: CloudServer;
  };
  readonly backendClient: BackendClient;
  readonly certificateDirectory: string;
  readonly loadDiscovery: () => Promise<LocalControllerDiscovery>;
};

export type LocalControllerDiscovery = {
  readonly userId?: string;
  readonly candidates: readonly CentralGatewayCandidate[];
};

export type LocalRoutesChangedListener = () => void;

type LocalControllerDependencies = {
  readonly getVirtualDid: typeof getVirtualDid;
  readonly createCertificateManager: (
    options: ConstructorParameters<typeof LocalCertificateManager>[0],
  ) => Pick<LocalCertificateManager, 'ensureCertificate'>;
  readonly discoverCentralRoutes: typeof discoverCentralRoutes;
  readonly createMqttClient: (
    options: LocalMqttClientOptions,
  ) => LocalMqttClient;
};

type LocalRouteRuntime = {
  readonly route: CentralRoute;
  readonly client: LocalMqttClient;
  readonly certificate: string;
  deviceInfoMap: ReadonlyMap<string, LocalDeviceInfo>;
  deviceListRefreshRequested: boolean;
  deviceListRetryTimeout: ReturnType<typeof setTimeout> | undefined;
  initializing: boolean;
  disposed: boolean;
  deviceListRefreshPromise?: Promise<void>;
  removeConnectionStateListener: () => void;
  removeDeviceListChangedListener: () => void;
};

const DEFAULT_DEPENDENCIES: LocalControllerDependencies = {
  getVirtualDid,
  createCertificateManager: options => new LocalCertificateManager(options),
  discoverCentralRoutes,
  createMqttClient: options => new LocalMqttClient(options),
};

function getRouteKey(route: CentralRoute): string {
  return `${route.did}\0${route.groupId}`;
}

function areRoutesEqual(left: CentralRoute, right: CentralRoute): boolean {
  return (
    left.did === right.did &&
    left.groupId === right.groupId &&
    left.homeName === right.homeName &&
    left.address === right.address &&
    left.port === right.port
  );
}

function throwRejectedResults(
  results: readonly PromiseSettledResult<unknown>[],
  message: string,
): void {
  const errors = results
    .filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    .map(result => result.reason as unknown);

  if (errors.length === 1) {
    throw errors[0];
  } else if (errors.length > 1) {
    throw new AggregateError(errors, message);
  }
}
