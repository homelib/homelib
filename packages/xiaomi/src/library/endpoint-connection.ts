import {
  EndpointConnection,
  type EndpointConnectionMetadata,
} from '@homelib/core';

import type {MiotEndpointCommand} from './command.js';
import type {MiotProvider} from './provider.js';

export class MiotEndpointConnection extends EndpointConnection<
  MiotEndpointCommand,
  MiotProvider,
  MiotEndpointConnectionMetadata
> {
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

export abstract class MiotEndpointConnectionTransport {}

export type MiotEndpointConnectionMetadata = EndpointConnectionMetadata & {
  readonly device: {
    readonly did: string;
    readonly model: string;
    readonly urn: string;
  };
  readonly service: {
    readonly siid: number;
    readonly urn: string;
  };
};
