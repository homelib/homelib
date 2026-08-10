import {
  CommandError,
  EndpointConnection,
  EndpointConnectionError,
  type EndpointConnectionMetadata,
  SetLightOnCommand,
} from '@homelib/core';
import * as x from 'x-value';

import type {MiotEndpointCommand} from './command.js';
import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  MiotSetPropertyRequest,
  MiotSpecProperty,
  MiotSpecService,
  isSuccessfulMiotExecutionResult,
} from './miot/index.js';
import type {MiotProvider} from './provider.js';

export const MiotEndpointConnectionMetadata = x.object({
  device: x.object({
    did: x.string,
    model: x.string,
    urn: x.string,
  }),
  service: MiotSpecService,
  properties: x.record(x.string, MiotSpecProperty),
});

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
    return `${this.metadata.device.did}/${this.metadata.service.iid}`;
  }

  override get online(): boolean {
    return true;
  }

  override async processCommand(command: MiotEndpointCommand): Promise<void> {
    const request = createMiotRequest(command, this.metadata);
    const [transport] = this.transports;
    let result: MiotExecutionResult;

    try {
      result = await transport.executeRequest(request);
    } catch (error) {
      const message =
        error instanceof Error
          ? `MIoT transport failed: ${error.message}`
          : 'MIoT transport failed.';
      throw new EndpointConnectionError(message);
    }

    if (!isSuccessfulMiotExecutionResult(result)) {
      throw new CommandError(`MIoT request failed: ${result.code}.`);
    }
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

export type MiotEndpointConnectionMetadata = EndpointConnectionMetadata &
  Readonly<x.TypeOf<typeof MiotEndpointConnectionMetadata>>;

function createMiotRequest(
  command: MiotEndpointCommand,
  metadata: MiotEndpointConnectionMetadata,
): MiotExecutionRequest {
  if (command instanceof SetLightOnCommand) {
    const property = metadata.properties.on;

    if (property === undefined) {
      throw new TypeError('MIoT endpoint metadata has no on property.');
    }

    return new MiotSetPropertyRequest(
      {
        did: metadata.device.did,
        siid: metadata.service.iid,
        piid: property.iid,
      },
      command.value,
    );
  }

  throw new TypeError(
    `Unsupported MIoT endpoint command: ${command.constructor.name}.`,
  );
}
