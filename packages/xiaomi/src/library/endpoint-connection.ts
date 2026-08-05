import {EndpointConnection} from '@homelib/core';

import type {MiotCommand} from './command.js';

export class MiotEndpointConnection extends EndpointConnection<MiotCommand> {
  override get id(): string {
    throw new Error('Method not implemented.');
  }

  override get online(): boolean {
    throw new Error('Method not implemented.');
  }

  override processCommand(_command: MiotCommand): Promise<void> {
    throw new Error('Method not implemented.');
  }
}

export abstract class MiotEndpointConnectionTransport {}
