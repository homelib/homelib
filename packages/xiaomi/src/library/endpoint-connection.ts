import {
  type Command,
  CommandError,
  type EndpointConnection,
  EndpointConnectionError,
  type EndpointConnectionMetadata,
} from '@homelib/core';
import {action, observable} from 'mobx';
import * as x from 'x-value';

import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  type MiotProperty,
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

export function getMiotEndpointConnectionResourceKey(
  metadata: MiotEndpointConnectionMetadata,
): string {
  return JSON.stringify([metadata.device.did, metadata.service.iid]);
}

export abstract class MiotEndpointConnection<
  in TCommand extends Command,
> implements EndpointConnection<TCommand> {
  @observable.shallow private accessor stateMap = new Map<string, unknown>();

  protected readonly transports: MiotEndpointConnectionTransports;

  get online(): boolean {
    return true;
  }

  get stateProperties(): readonly MiotProperty[] {
    const {metadata} = this;
    return Object.values(metadata.properties).map(property => {
      return {
        did: metadata.device.did,
        siid: metadata.service.iid,
        piid: property.iid,
      };
    });
  }

  constructor(
    readonly provider: MiotProvider,
    readonly metadata: MiotEndpointConnectionMetadata,
    transports: MiotEndpointConnectionTransports,
  ) {
    this.transports = transports;
  }

  @action
  handlePropertyUpdate(update: MiotPropertyUpdate): void {
    const {metadata} = this;

    if (
      update.did !== metadata.device.did ||
      update.siid !== metadata.service.iid
    ) {
      throw new TypeError('Unexpected MIoT endpoint property update.');
    }

    let stateName: string | undefined;

    for (const [name, property] of Object.entries(metadata.properties)) {
      if (property.iid !== update.piid) {
        continue;
      }

      if (stateName !== undefined) {
        throw new TypeError('Ambiguous MIoT endpoint property update.');
      }

      stateName = name;
    }

    if (stateName === undefined) {
      throw new TypeError('Unexpected MIoT endpoint property update.');
    }

    this.stateMap.set(stateName, update.value);
  }

  abstract processCommand(command: TCommand): Promise<void>;

  protected getState(name: string): unknown {
    return this.stateMap.get(name);
  }

  protected async executeRequest(request: MiotExecutionRequest): Promise<void> {
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

export type MiotPropertyUpdate = MiotProperty & {
  readonly value: unknown;
};
