import {
  FanEndpoint,
  type FanEndpointCommand,
  type FanEndpointConnection,
  SetFanOnCommand,
} from '@homelib/core';
import {computed} from 'mobx';
import * as x from 'x-value';

import {
  defineMiotEndpointAdapter,
  getValidatedMiotEndpointProperties,
} from '../endpoint-adapter.js';
import {
  MiotEndpointConnection,
  type MiotEndpointConnectionMetadata,
  type MiotEndpointConnectionTransports,
} from '../endpoint-connection.js';
import {
  type MiotEndpointMatcher,
  type MiotExecutionRequest,
  type MiotPropertyMatcher,
  MiotSetPropertyRequest,
  type MiotSpecProperty,
} from '../miot/index.js';
import type {MiotProvider} from '../provider.js';

const MiotFanOn = x.union([x.boolean, x.undefined]);

const MIOT_FAN_ENDPOINT_MATCHER: MiotFanEndpointMatcher = {
  service: 'urn:miot-spec-v2:service:fan:00007808',
  properties: {
    on: {
      type: 'urn:miot-spec-v2:property:on:00000006',
      format: 'bool',
      access: ['read', 'write', 'notify'],
    },
  },
};

const MIOT_FAN_ENDPOINT_MATCHERS = [
  MIOT_FAN_ENDPOINT_MATCHER,
] as const satisfies readonly MiotFanEndpointMatcher[];

export class MiotFanEndpointConnection
  extends MiotEndpointConnection<FanEndpointCommand>
  implements FanEndpointConnection
{
  static readonly Endpoint = FanEndpoint;

  static readonly endpointMatchers = MIOT_FAN_ENDPOINT_MATCHERS;

  private readonly onProperty: MiotSpecProperty;

  @computed
  get on(): boolean | undefined {
    return MiotFanOn.satisfies(this.getState('on'));
  }

  constructor(
    provider: MiotProvider,
    metadata: MiotEndpointConnectionMetadata,
    transports: MiotEndpointConnectionTransports,
  ) {
    super(provider, metadata, transports);
    this.onProperty = getValidatedMiotEndpointProperties(
      'fan',
      metadata,
      MIOT_FAN_ENDPOINT_MATCHERS,
    ).on;
  }

  static assertMetadata(metadata: MiotEndpointConnectionMetadata): void {
    getValidatedMiotEndpointProperties(
      'fan',
      metadata,
      MIOT_FAN_ENDPOINT_MATCHERS,
    );
  }

  override async processCommand(command: FanEndpointCommand): Promise<void> {
    await this.executeRequest(
      createMiotFanRequest(command, this.metadata, this.onProperty),
    );
  }
}

export const miotFanEndpointAdapter = defineMiotEndpointAdapter<
  FanEndpointCommand,
  FanEndpointConnection
>({
  type: 'fan',
  Endpoint: MiotFanEndpointConnection.Endpoint,
  Connection: MiotFanEndpointConnection,
  endpointMatchers: MiotFanEndpointConnection.endpointMatchers,
});

type MiotFanEndpointMatcher = MiotEndpointMatcher<{
  readonly on: MiotPropertyMatcher;
}>;

function createMiotFanRequest(
  command: FanEndpointCommand,
  metadata: MiotEndpointConnectionMetadata,
  onProperty: MiotSpecProperty,
): MiotExecutionRequest {
  if (command instanceof SetFanOnCommand) {
    return new MiotSetPropertyRequest(
      {
        did: metadata.device.did,
        siid: metadata.service.iid,
        piid: onProperty.iid,
      },
      command.value,
    );
  }

  throw new TypeError('Unsupported MIoT fan endpoint command.');
}
