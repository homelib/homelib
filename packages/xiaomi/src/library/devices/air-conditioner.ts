import {
  AirConditionerEndpoint,
  type AirConditionerEndpointCommand,
  type AirConditionerEndpointConnection,
  SetAirConditionerOnCommand,
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

const MiotAirConditionerOn = x.union([x.boolean, x.undefined]);

const MIOT_AIR_CONDITIONER_ENDPOINT_MATCHER: MiotAirConditionerEndpointMatcher =
  {
    service: 'urn:miot-spec-v2:service:air-conditioner:0000780F',
    properties: {
      on: {
        type: 'urn:miot-spec-v2:property:on:00000006',
        format: 'bool',
        access: ['read', 'write', 'notify'],
      },
    },
  };

const MIOT_AIR_CONDITIONER_ENDPOINT_MATCHERS = [
  MIOT_AIR_CONDITIONER_ENDPOINT_MATCHER,
] as const satisfies readonly MiotAirConditionerEndpointMatcher[];

export class MiotAirConditionerEndpointConnection
  extends MiotEndpointConnection<AirConditionerEndpointCommand>
  implements AirConditionerEndpointConnection
{
  static readonly Endpoint = AirConditionerEndpoint;

  static readonly endpointMatchers = MIOT_AIR_CONDITIONER_ENDPOINT_MATCHERS;

  private readonly onProperty: MiotSpecProperty;

  @computed
  get on(): boolean | undefined {
    return MiotAirConditionerOn.satisfies(this.getState('on'));
  }

  constructor(
    provider: MiotProvider,
    metadata: MiotEndpointConnectionMetadata,
    transports: MiotEndpointConnectionTransports,
  ) {
    super(provider, metadata, transports);
    this.onProperty = getValidatedMiotEndpointProperties(
      'air-conditioner',
      metadata,
      MIOT_AIR_CONDITIONER_ENDPOINT_MATCHERS,
    ).on;
  }

  static assertMetadata(metadata: MiotEndpointConnectionMetadata): void {
    getValidatedMiotEndpointProperties(
      'air-conditioner',
      metadata,
      MIOT_AIR_CONDITIONER_ENDPOINT_MATCHERS,
    );
  }

  override async processCommand(
    command: AirConditionerEndpointCommand,
  ): Promise<void> {
    await this.executeRequest(
      createMiotAirConditionerRequest(command, this.metadata, this.onProperty),
    );
  }
}

export const miotAirConditionerEndpointAdapter = defineMiotEndpointAdapter<
  AirConditionerEndpointCommand,
  AirConditionerEndpointConnection
>({
  type: 'air-conditioner',
  Endpoint: MiotAirConditionerEndpointConnection.Endpoint,
  Connection: MiotAirConditionerEndpointConnection,
  endpointMatchers: MiotAirConditionerEndpointConnection.endpointMatchers,
});

type MiotAirConditionerEndpointMatcher = MiotEndpointMatcher<{
  readonly on: MiotPropertyMatcher;
}>;

function createMiotAirConditionerRequest(
  command: AirConditionerEndpointCommand,
  metadata: MiotEndpointConnectionMetadata,
  onProperty: MiotSpecProperty,
): MiotExecutionRequest {
  if (command instanceof SetAirConditionerOnCommand) {
    return new MiotSetPropertyRequest(
      {
        did: metadata.device.did,
        siid: metadata.service.iid,
        piid: onProperty.iid,
      },
      command.value,
    );
  }

  throw new TypeError('Unsupported MIoT air conditioner endpoint command.');
}
