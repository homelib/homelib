import {
  EndpointConnection,
  type EndpointConnectionMetadata,
} from '@homelib/core';

import type {MiotEndpointCommand} from './command.js';
import type {
  MiotExecutionRequest,
  MiotExecutionResult,
  MiotSpecProperty,
  MiotSpecService,
} from './miot/index.js';
import type {MiotProvider} from './provider.js';

export class MiotEndpointConnection extends EndpointConnection<
  MiotEndpointCommand,
  MiotProvider,
  MiotEndpointConnectionMetadata
> {
  protected readonly transports: MiotEndpointConnectionTransports;

  constructor(
    provider: MiotProvider,
    metadata: MiotEndpointConnectionMetadata,
    transports: MiotEndpointConnectionTransports,
  ) {
    super(provider, metadata);
    this.transports = transports;
  }

  override get id(): string {
    throw new Error('Method not implemented.');
  }

  override get online(): boolean {
    throw new Error('Method not implemented.');
  }

  override processCommand(_command: MiotEndpointCommand): Promise<void> {
    throw new Error('Method not implemented.');
  }
}

export abstract class MiotEndpointConnectionTransport {
  abstract executeRequest(
    request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult>;
}

export type MiotEndpointConnectionTransports = readonly [
  MiotEndpointConnectionTransport,
  ...MiotEndpointConnectionTransport[],
];

export type MiotEndpointConnectionMetadata = EndpointConnectionMetadata & {
  readonly device: {
    readonly did: string;
    readonly model: string;
    readonly urn: string;
  };
  readonly service: MiotSpecService;
  readonly properties: Readonly<Record<string, MiotSpecProperty>>;
};
