import {join} from 'node:path';

import {
  $constructor,
  type Endpoint,
  type EndpointConnection,
  LightEndpoint,
  Provider,
  getEnvironmentDirectory,
  register,
  uniqueName,
} from '@homelib/core';
import {action, observable} from 'mobx';

import {BackendClient} from './backend/index.js';
import {MiotEndpointConnectionCloudTransport} from './cloud/transport.js';
import type {MiotEndpointCommand} from './command.js';
import {
  MiotEndpointConnection,
  MiotEndpointConnectionMetadata,
} from './endpoint-connection.js';
import {loadValidOAuthSession} from './session.js';

export const MIOT_NAMESPACE = 'miot';

export class MiotProvider extends Provider<
  MiotEndpointCommand,
  MiotEndpointConnectionMetadata
> {
  override readonly EndpointConnectionMetadata =
    MiotEndpointConnectionMetadata;

  @observable.shallow
  private accessor endpointConnectionValues: MiotEndpointConnection[] = [];

  private cloudTransportPromise:
    Promise<MiotEndpointConnectionCloudTransport> | undefined;

  override get endpointConnections(): readonly EndpointConnection<MiotEndpointCommand>[] {
    return this.endpointConnectionValues;
  }

  override async createEndpointConnection(
    endpoint: Endpoint<MiotEndpointCommand>,
    metadata: MiotEndpointConnectionMetadata,
  ): Promise<MiotEndpointConnection> {
    if (!(endpoint instanceof LightEndpoint)) {
      throw new TypeError('MIoT light metadata requires a light endpoint.');
    }

    const cloudTransport = await this.getCloudTransport();
    const connection = new MiotEndpointConnection(this, metadata, [
      cloudTransport,
    ]);

    this.addEndpointConnection(connection);

    return connection;
  }

  private getCloudTransport(): Promise<MiotEndpointConnectionCloudTransport> {
    let cloudTransportPromise = this.cloudTransportPromise;

    if (cloudTransportPromise === undefined) {
      cloudTransportPromise = this.createCloudTransport();
      this.cloudTransportPromise = cloudTransportPromise;
    }

    return cloudTransportPromise;
  }

  private async createCloudTransport(): Promise<MiotEndpointConnectionCloudTransport> {
    const session = await loadValidOAuthSession(this.getSessionPath());
    const backendClient = new BackendClient({
      uuid: session.uuid,
      accessToken: session.token.accessToken,
      cloudServer: session.cloudServer,
    });

    return new MiotEndpointConnectionCloudTransport(backendClient);
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
  private addEndpointConnection(connection: MiotEndpointConnection): void {
    this.endpointConnectionValues.push(connection);
  }
}

export const $xiaomi = $constructor(MiotProvider)
  .build(uniqueName('provider'))
  .build(provider => {
    register(MIOT_NAMESPACE, provider);
  });
