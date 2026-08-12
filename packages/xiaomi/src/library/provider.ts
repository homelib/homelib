import {rm} from 'node:fs/promises';
import {join} from 'node:path';

import {
  $constructor,
  type EndpointConnectionBinding,
  type EndpointConnectionBindingPlan,
  type EndpointReference,
  ExponentialBackoff,
  Provider,
  getEnvironmentDirectory,
  register,
  uniqueName,
} from '@homelib/core';
import {action, observable} from 'mobx';

import type {CloudServer} from './backend/index.js';
import {BackendClient} from './backend/index.js';
import {CloudClient} from './cloud/client.js';
import type {CloudDeviceSubscription} from './cloud/device.js';
import {MiotEndpointConnectionCloudTransport} from './cloud/transport.js';
import {
  MiotProviderConfiguration,
  type MiotProviderConfigurationDiscovery,
} from './configuration.js';
import {getMiotEndpointAdapter} from './devices/index.js';
import type {MiotEndpointAdapter} from './endpoint-adapter.js';
import {
  type MiotEndpointConnection,
  MiotEndpointConnectionMetadata,
  getMiotEndpointConnectionResourceKeys,
} from './endpoint-connection.js';
import type {MiotProperty} from './miot/index.js';
import {OAuthSessionManager} from './session-manager.js';
import {
  type OAuthSession,
  type OAuthSessionAuthorization,
  OAuthSessionMissingError,
  beginOAuthSessionAuthorization,
} from './session.js';

export const MIOT_NAMESPACE = 'miot';

export class MiotProvider extends Provider<MiotEndpointConnectionMetadata> {
  override readonly EndpointConnectionMetadata = MiotEndpointConnectionMetadata;

  readonly configuration: MiotProviderConfiguration;

  @observable.shallow
  private accessor endpointConnectionValues: MiotEndpointConnection<never>[] =
    [];

  private readonly endpointConnectionSubscriptionMap = new Map<
    MiotEndpointConnection<never>,
    CloudDeviceSubscription
  >();

  private readonly endpointConnectionRuntimeMap = new Map<
    MiotEndpointConnection<never>,
    MiotEndpointConnectionRuntime
  >();

  private endpointConnectionCreationCount = 0;

  private endpointConnectionDisposalCount = 0;

  private cloudPromise: Promise<MiotProviderCloud> | undefined;

  private cloudValue: MiotProviderCloud | undefined;

  private readonly discoveryBackendClientSet = new Set<BackendClient>();

  private authorizationInProgress = false;

  private authorization: OAuthSessionAuthorization | undefined;

  private authorizationSetupPromise:
    Promise<OAuthSessionAuthorization> | undefined;

  private authorizationGeneration = 0;

  private forgetAuthorizationPromise: Promise<void> | undefined;

  private readonly sessionPath: string;

  private readonly oauthUuidPath: string;

  private readonly sessionManager: OAuthSessionManager;

  constructor(name: string) {
    super(name);

    const environmentDirectory = getEnvironmentDirectory();
    const providerDirectory = join(
      environmentDirectory,
      'providers',
      MIOT_NAMESPACE,
    );

    this.sessionPath = join(providerDirectory, `${name}.json`);
    this.oauthUuidPath = join(providerDirectory, 'identity', `${name}.json`);
    this.sessionManager = new OAuthSessionManager({
      sessionPath: this.sessionPath,
      applyAccessToken: accessToken => {
        this.cloudValue?.client.updateAccessToken(accessToken);

        for (const backendClient of this.discoveryBackendClientSet) {
          backendClient.updateAccessToken(accessToken);
        }
      },
    });
    this.configuration = new MiotProviderConfiguration({
      providerName: name,
      environmentDirectory,
      dependencies: {
        discoverDevices: () => this.discoverConfigurationDevices(),
        beginAuthorization: cloudServer =>
          this.beginConfigurationAuthorization(cloudServer),
        forgetAuthorization: () => this.forgetConfigurationAuthorization(),
      },
    });
  }

  override get endpointConnections(): readonly MiotEndpointConnection<never>[] {
    return this.endpointConnectionValues;
  }

  protected override createEndpointConnectionBindingPlanFromMetadata(
    endpoint: EndpointReference,
    metadata: MiotEndpointConnectionMetadata,
  ): EndpointConnectionBindingPlan {
    const endpointAdapter = getMiotEndpointAdapter(endpoint);

    if (endpointAdapter === undefined) {
      throw new TypeError('Unsupported MIoT endpoint.');
    }

    endpointAdapter.assertMetadata(metadata);

    return {
      resourceKeys: getMiotEndpointConnectionResourceKeys(metadata),
      create: () =>
        this.createEndpointConnectionBinding(
          endpointAdapter,
          endpoint,
          metadata,
        ),
    };
  }

  private async createEndpointConnectionBinding(
    endpointAdapter: MiotEndpointAdapter,
    endpoint: EndpointReference,
    metadata: MiotEndpointConnectionMetadata,
  ): Promise<EndpointConnectionBinding> {
    this.endpointConnectionCreationCount++;
    let cloud: MiotProviderCloud | undefined;
    let outcome: BindingCreationOutcome;

    try {
      cloud = await this.getCloud();
      const {connection, binding} = endpointAdapter.createBinding(
        this,
        endpoint,
        metadata,
        [cloud.transport],
        value => this.disposeEndpointConnection(value),
      );
      const stateProperties = connection.stateProperties;
      const runtime: MiotEndpointConnectionRuntime = {
        active: true,
        backoff: new ExponentialBackoff(1_000, 60_000),
      };

      this.addEndpointConnection(connection);
      this.endpointConnectionRuntimeMap.set(connection, runtime);
      const subscriptionPromise = this.subscribeEndpointConnection(
        connection,
        stateProperties,
        cloud.client,
        runtime,
      );
      runtime.subscriptionPromise = subscriptionPromise;
      void subscriptionPromise.catch(console.error);

      outcome = {type: 'success', binding};
    } catch (error) {
      outcome = {type: 'error', error};
    }

    this.endpointConnectionCreationCount--;

    if (outcome.type === 'success') {
      return outcome.binding;
    }

    const errors = [outcome.error];

    if (cloud !== undefined) {
      try {
        await this.disposeCloudIfUnused(cloud);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }

    throw new AggregateError(errors, 'Failed to create MIoT connection.');
  }

  private getCloud(): Promise<MiotProviderCloud> {
    if (this.authorizationInProgress) {
      throw new Error(
        'Cannot start MIoT connections while authorization is in progress.',
      );
    }

    let cloudPromise = this.cloudPromise;

    if (cloudPromise === undefined) {
      cloudPromise = this.createCloud();
      this.cloudPromise = cloudPromise;
      void cloudPromise.catch(() => {
        if (this.cloudPromise === cloudPromise) {
          this.cloudPromise = undefined;
        }
      });
    }

    return cloudPromise;
  }

  private async createCloud(): Promise<MiotProviderCloud> {
    const authorizationGeneration = this.authorizationGeneration;
    const session = await this.sessionManager.getSession();

    this.assertAuthorizationGeneration(authorizationGeneration);

    const backendClient = createBackendClient(session);
    const cloud = {
      client: new CloudClient(backendClient),
      transport: new MiotEndpointConnectionCloudTransport(backendClient),
    };

    this.cloudValue = cloud;
    return cloud;
  }

  private async discoverConfigurationDevices(): Promise<
    MiotProviderConfigurationDiscovery | undefined
  > {
    if (this.authorizationInProgress) {
      throw new Error(
        'Cannot discover MIoT devices while authorization is in progress.',
      );
    }

    const authorizationGeneration = this.authorizationGeneration;
    let session: OAuthSession;

    try {
      session = await this.sessionManager.getSession();
    } catch (error) {
      if (error instanceof OAuthSessionMissingError) {
        return undefined;
      }

      throw error;
    }

    this.assertAuthorizationGeneration(authorizationGeneration);

    const backendClient = createBackendClient(session);
    this.discoveryBackendClientSet.add(backendClient);

    let discovery;

    try {
      discovery = await backendClient.discoverDevices();
    } finally {
      this.discoveryBackendClientSet.delete(backendClient);
    }

    this.assertAuthorizationGeneration(authorizationGeneration);

    return {
      account: {
        cloudServer: session.cloudServer,
        userId: discovery.userId ?? null,
      },
      homes: discovery.homes,
      devices: discovery.devices,
    };
  }

  private async beginConfigurationAuthorization(
    cloudServer: CloudServer,
  ): Promise<{
    readonly url: string;
    wait(): Promise<void>;
    cancel(): Promise<void>;
  }> {
    if (this.authorizationInProgress) {
      throw new Error('MIoT provider authorization is already in progress.');
    } else if (
      this.cloudPromise !== undefined ||
      this.endpointConnectionValues.length > 0
    ) {
      throw new Error(
        'Cannot authorize a MIoT provider after its connections have started.',
      );
    }

    const generation = ++this.authorizationGeneration;
    this.authorizationInProgress = true;

    let authorization: OAuthSessionAuthorization;

    try {
      await this.sessionManager.reset();

      if (this.authorizationGeneration !== generation) {
        throw new Error('MIoT provider authorization was cancelled.');
      }

      const setupPromise = beginOAuthSessionAuthorization({
        sessionPath: this.sessionPath,
        uuidPath: this.oauthUuidPath,
        cloudServer,
      });
      this.authorizationSetupPromise = setupPromise;

      try {
        authorization = await setupPromise;
      } finally {
        if (this.authorizationSetupPromise === setupPromise) {
          this.authorizationSetupPromise = undefined;
        }
      }

      if (this.authorizationGeneration !== generation) {
        await authorization.cancel();
        throw new Error('MIoT provider authorization was cancelled.');
      }

      this.authorization = authorization;
    } catch (error) {
      if (this.authorizationGeneration === generation) {
        this.authorizationInProgress = false;
      }

      throw error;
    }

    const completion = (async () => {
      try {
        const session = await authorization.wait();

        if (this.authorization === authorization) {
          this.sessionManager.useSession(session);
        }
      } finally {
        if (this.authorization === authorization) {
          this.authorization = undefined;
          this.authorizationInProgress = false;
        }
      }
    })();

    void completion.catch(() => undefined);
    return {
      url: authorization.url,
      wait: () => completion,
      cancel: () => authorization.cancel(),
    };
  }

  private forgetConfigurationAuthorization(): Promise<void> {
    let forgetPromise = this.forgetAuthorizationPromise;

    if (forgetPromise === undefined) {
      const newForgetPromise = this.performForgetConfigurationAuthorization();
      forgetPromise = newForgetPromise;
      this.forgetAuthorizationPromise = newForgetPromise;
      void newForgetPromise.then(
        () => {
          this.completeForgetConfigurationAuthorization(newForgetPromise);
        },
        () => {
          this.completeForgetConfigurationAuthorization(newForgetPromise);
        },
      );
    }

    return forgetPromise;
  }

  private async performForgetConfigurationAuthorization(): Promise<void> {
    const generation = ++this.authorizationGeneration;
    let authorization = this.authorization;
    const authorizationSetupPromise = this.authorizationSetupPromise;
    this.authorization = undefined;
    this.authorizationInProgress = true;

    try {
      await this.sessionManager.reset();

      if (
        authorization === undefined &&
        authorizationSetupPromise !== undefined
      ) {
        authorization = await authorizationSetupPromise.catch(() => undefined);
      }

      if (authorization !== undefined) {
        await authorization.cancel();
        await authorization.wait().catch(() => undefined);
        await this.sessionManager.reset();
      }

      await rm(this.sessionPath, {force: true});
    } finally {
      if (this.authorizationGeneration === generation) {
        this.authorizationInProgress = false;
      }
    }
  }

  private completeForgetConfigurationAuthorization(
    forgetPromise: Promise<void>,
  ): void {
    if (this.forgetAuthorizationPromise === forgetPromise) {
      this.forgetAuthorizationPromise = undefined;
    }
  }

  private assertAuthorizationGeneration(generation: number): void {
    if (
      this.authorizationInProgress ||
      this.authorizationGeneration !== generation
    ) {
      throw new Error('MIoT provider authorization changed during operation.');
    }
  }

  private async subscribeEndpointConnection(
    connection: MiotEndpointConnection<never>,
    properties: readonly MiotProperty[],
    cloudClient: CloudClient,
    runtime: MiotEndpointConnectionRuntime,
  ): Promise<void> {
    while (runtime.active) {
      try {
        const subscription = await cloudClient.subscribeDevice(
          connection.metadata.device.did,
          properties,
          {
            onStateChanged: state => {
              connection.handleStateUpdate(state);
            },
            onPropertyChanged: update => {
              connection.handlePropertyUpdate(update);
            },
            onError: console.error,
          },
        );

        if (!runtime.active) {
          await subscription.dispose();
          return;
        }

        this.endpointConnectionSubscriptionMap.set(connection, subscription);
        return;
      } catch (error) {
        if (!runtime.active) {
          return;
        }

        console.error(error);
        await runtime.backoff;
      }
    }
  }

  private async disposeEndpointConnection(
    connection: MiotEndpointConnection<never>,
  ): Promise<void> {
    const runtime = this.endpointConnectionRuntimeMap.get(connection);

    if (runtime === undefined) {
      return;
    }

    this.endpointConnectionDisposalCount++;
    runtime.active = false;
    runtime.backoff.reset();
    const errors: unknown[] = [];

    try {
      await runtime.subscriptionPromise;
    } catch (error) {
      errors.push(error);
    }

    const subscription = this.endpointConnectionSubscriptionMap.get(connection);
    this.endpointConnectionSubscriptionMap.delete(connection);

    try {
      await subscription?.dispose();
    } catch (error) {
      errors.push(error);
    }

    this.endpointConnectionRuntimeMap.delete(connection);

    try {
      this.removeEndpointConnection(connection);
    } catch (error) {
      errors.push(error);
    }

    this.endpointConnectionDisposalCount--;

    try {
      await this.disposeCloudIfUnused();
    } catch (error) {
      errors.push(error);
    }

    if (errors.length === 1) {
      throw errors[0];
    } else if (errors.length > 1) {
      throw new AggregateError(errors, 'Failed to dispose MIoT connection.');
    }
  }

  private async disposeCloudIfUnused(
    expectedCloud?: MiotProviderCloud,
  ): Promise<void> {
    if (
      this.endpointConnectionCreationCount > 0 ||
      this.endpointConnectionDisposalCount > 0 ||
      this.endpointConnectionRuntimeMap.size > 0 ||
      (expectedCloud !== undefined && this.cloudValue !== expectedCloud)
    ) {
      return;
    }

    const cloud = this.cloudValue;
    this.cloudValue = undefined;
    this.cloudPromise = undefined;
    const errors: unknown[] = [];

    try {
      await cloud?.client.disconnect();
    } catch (error) {
      errors.push(error);
    }

    if (
      this.endpointConnectionCreationCount === 0 &&
      this.endpointConnectionDisposalCount === 0 &&
      this.endpointConnectionRuntimeMap.size === 0 &&
      this.cloudValue === undefined &&
      this.cloudPromise === undefined
    ) {
      try {
        await this.sessionManager.reset();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    } else if (errors.length > 1) {
      throw new AggregateError(errors, 'Failed to dispose MIoT cloud.');
    }
  }

  @action
  private addEndpointConnection(
    connection: MiotEndpointConnection<never>,
  ): void {
    this.endpointConnectionValues.push(connection);
  }

  @action
  private removeEndpointConnection(
    connection: MiotEndpointConnection<never>,
  ): void {
    const index = this.endpointConnectionValues.indexOf(connection);

    if (index >= 0) {
      this.endpointConnectionValues.splice(index, 1);
    }
  }
}

export const $xiaomi = $constructor(MiotProvider)
  .build(uniqueName('provider'))
  .build(provider => {
    register(MIOT_NAMESPACE, provider);
  });

type MiotProviderCloud = {
  readonly client: CloudClient;
  readonly transport: MiotEndpointConnectionCloudTransport;
};

type MiotEndpointConnectionRuntime = {
  active: boolean;
  readonly backoff: ExponentialBackoff;
  subscriptionPromise?: Promise<void>;
};

type BindingCreationOutcome =
  | {readonly type: 'success'; readonly binding: EndpointConnectionBinding}
  | {readonly type: 'error'; readonly error: unknown};

function createBackendClient(session: OAuthSession): BackendClient {
  return new BackendClient({
    uuid: session.uuid,
    accessToken: session.token.accessToken,
    cloudServer: session.cloudServer,
  });
}
