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
  getMiotEndpointConnectionResourceKey,
} from './endpoint-connection.js';
import type {MiotProperty} from './miot/index.js';
import {
  type OAuthSession,
  type OAuthSessionAuthorization,
  OAuthSessionMissingError,
  beginOAuthSessionAuthorization,
  loadValidOAuthSession,
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

  private cloudPromise: Promise<MiotProviderCloud> | undefined;

  private authorizationInProgress = false;

  private readonly sessionPath: string;

  private readonly oauthUuidPath: string;

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
      resourceKeys: [getMiotEndpointConnectionResourceKey(metadata)],
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
    const cloud = await this.getCloud();
    const {connection, binding} = endpointAdapter.createBinding(
      this,
      endpoint,
      metadata,
      [cloud.transport],
    );
    const stateProperties = connection.stateProperties;

    this.addEndpointConnection(connection);
    void this.subscribeEndpointConnection(
      connection,
      stateProperties,
      cloud.client,
    ).catch(console.error);

    return binding;
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
    const backendClient = await this.createBackendClient();

    return {
      client: new CloudClient(backendClient),
      transport: new MiotEndpointConnectionCloudTransport(backendClient),
    };
  }

  private async createBackendClient(): Promise<BackendClient> {
    const session = await loadValidOAuthSession(this.sessionPath);

    return new BackendClient({
      uuid: session.uuid,
      accessToken: session.token.accessToken,
      cloudServer: session.cloudServer,
    });
  }

  private async discoverConfigurationDevices(): Promise<
    MiotProviderConfigurationDiscovery | undefined
  > {
    let session: OAuthSession;

    try {
      session = await loadValidOAuthSession(this.sessionPath);
    } catch (error) {
      if (error instanceof OAuthSessionMissingError) {
        return undefined;
      }

      throw error;
    }

    const discovery = await new BackendClient({
      uuid: session.uuid,
      accessToken: session.token.accessToken,
      cloudServer: session.cloudServer,
    }).discoverDevices();

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

    this.authorizationInProgress = true;

    let authorization: OAuthSessionAuthorization;

    try {
      authorization = await beginOAuthSessionAuthorization({
        sessionPath: this.sessionPath,
        uuidPath: this.oauthUuidPath,
        cloudServer,
      });
    } catch (error) {
      this.authorizationInProgress = false;
      throw error;
    }

    const completion = (async () => {
      try {
        await authorization.wait();
      } finally {
        this.authorizationInProgress = false;
      }
    })();

    void completion.catch(() => undefined);
    return {
      url: authorization.url,
      wait: () => completion,
      cancel: () => authorization.cancel(),
    };
  }

  private async forgetConfigurationAuthorization(): Promise<void> {
    await rm(this.sessionPath, {force: true});
  }

  private async subscribeEndpointConnection(
    connection: MiotEndpointConnection<never>,
    properties: readonly MiotProperty[],
    cloudClient: CloudClient,
  ): Promise<void> {
    const backoff = new ExponentialBackoff(1_000, 60_000);

    while (true) {
      try {
        const subscription = await cloudClient.subscribeDevice(
          connection.metadata.device.did,
          properties,
          {
            onPropertyChanged: update => {
              connection.handlePropertyUpdate(update);
            },
            onError: console.error,
          },
        );

        this.endpointConnectionSubscriptionMap.set(connection, subscription);
        return;
      } catch (error) {
        console.error(error);
        await backoff;
      }
    }
  }

  @action
  private addEndpointConnection(
    connection: MiotEndpointConnection<never>,
  ): void {
    this.endpointConnectionValues.push(connection);
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
