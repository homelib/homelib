import {join} from 'node:path';

import {
  $constructor,
  type EndpointConnectionBinding,
  type EndpointConnectionBindingPlan,
  type EndpointReference,
  ExponentialBackoff,
  LightEndpoint,
  Provider,
  createEndpointConnectionBinding,
  getEnvironmentDirectory,
  register,
  uniqueName,
} from '@homelib/core';
import {action, observable} from 'mobx';

import {BackendClient} from './backend/index.js';
import {CloudClient} from './cloud/client.js';
import type {CloudDeviceSubscription} from './cloud/device.js';
import {MiotEndpointConnectionCloudTransport} from './cloud/transport.js';
import {MiotLightEndpointConnection} from './devices/index.js';
import {
  type MiotEndpointConnection,
  MiotEndpointConnectionMetadata,
} from './endpoint-connection.js';
import type {MiotProperty} from './miot/index.js';
import {loadValidOAuthSession} from './session.js';

export const MIOT_NAMESPACE = 'miot';

export class MiotProvider extends Provider<MiotEndpointConnectionMetadata> {
  override readonly EndpointConnectionMetadata = MiotEndpointConnectionMetadata;

  @observable.shallow
  private accessor endpointConnectionValues: MiotEndpointConnection<never>[] =
    [];

  private readonly endpointConnectionSubscriptionMap = new Map<
    MiotEndpointConnection<never>,
    CloudDeviceSubscription
  >();

  private cloudPromise: Promise<MiotProviderCloud> | undefined;

  override get endpointConnections(): readonly MiotEndpointConnection<never>[] {
    return this.endpointConnectionValues;
  }

  protected override createEndpointConnectionBindingPlanFromMetadata(
    endpoint: EndpointReference,
    metadata: MiotEndpointConnectionMetadata,
  ): EndpointConnectionBindingPlan {
    if (!(endpoint instanceof LightEndpoint)) {
      throw new TypeError('MIoT light metadata requires a light endpoint.');
    }

    MiotLightEndpointConnection.assertMetadata(metadata);

    return {
      create: () =>
        this.createLightEndpointConnectionBinding(endpoint, metadata),
    };
  }

  private async createLightEndpointConnectionBinding(
    endpoint: LightEndpoint,
    metadata: MiotEndpointConnectionMetadata,
  ): Promise<EndpointConnectionBinding> {
    const cloud = await this.getCloud();
    const connection = new MiotLightEndpointConnection(this, metadata, [
      cloud.transport,
    ]);
    const stateProperties = connection.stateProperties;

    this.addEndpointConnection(connection);
    void this.subscribeEndpointConnection(
      connection,
      stateProperties,
      cloud.client,
    ).catch(console.error);

    return createEndpointConnectionBinding(endpoint, connection);
  }

  private getCloud(): Promise<MiotProviderCloud> {
    let cloudPromise = this.cloudPromise;

    if (cloudPromise === undefined) {
      cloudPromise = this.createCloud();
      this.cloudPromise = cloudPromise;
    }

    return cloudPromise;
  }

  private async createCloud(): Promise<MiotProviderCloud> {
    const session = await loadValidOAuthSession(this.getSessionPath());
    const backendClient = new BackendClient({
      uuid: session.uuid,
      accessToken: session.token.accessToken,
      cloudServer: session.cloudServer,
    });

    return {
      client: new CloudClient(backendClient),
      transport: new MiotEndpointConnectionCloudTransport(backendClient),
    };
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

  private getSessionPath(): string {
    const {name} = this;

    if (
      name === '' ||
      name === '.' ||
      name === '..' ||
      name.includes('/') ||
      name.includes('\\')
    ) {
      throw new TypeError(`Invalid MIoT provider name: ${name}.`);
    }

    return join(
      getEnvironmentDirectory(),
      'providers',
      MIOT_NAMESPACE,
      `${name}.json`,
    );
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
