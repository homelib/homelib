import {
  DehumidifierEndpoint,
  type DehumidifierEndpointCommand,
  type DehumidifierEndpointConnection,
  SetDehumidifierOnCommand,
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

const MiotDehumidifierOn = x.union([x.boolean, x.undefined]);

const MIOT_DEHUMIDIFIER_ENDPOINT_MATCHER: MiotDehumidifierEndpointMatcher = {
  service: 'urn:miot-spec-v2:service:dehumidifier:00007841',
  properties: {
    on: {
      type: 'urn:miot-spec-v2:property:on:00000006',
      format: 'bool',
      access: ['read', 'write', 'notify'],
    },
  },
};

const MIOT_DEHUMIDIFIER_ENDPOINT_MATCHERS = [
  MIOT_DEHUMIDIFIER_ENDPOINT_MATCHER,
] as const satisfies readonly MiotDehumidifierEndpointMatcher[];

export class MiotDehumidifierEndpointConnection
  extends MiotEndpointConnection<DehumidifierEndpointCommand>
  implements DehumidifierEndpointConnection
{
  static readonly Endpoint = DehumidifierEndpoint;

  static readonly endpointMatchers = MIOT_DEHUMIDIFIER_ENDPOINT_MATCHERS;

  private readonly onProperty: MiotSpecProperty;

  @computed
  get on(): boolean | undefined {
    return MiotDehumidifierOn.satisfies(this.getState('on'));
  }

  constructor(
    provider: MiotProvider,
    metadata: MiotEndpointConnectionMetadata,
    transports: MiotEndpointConnectionTransports,
  ) {
    super(provider, metadata, transports);
    this.onProperty = getValidatedMiotEndpointProperties(
      'dehumidifier',
      metadata,
      MIOT_DEHUMIDIFIER_ENDPOINT_MATCHERS,
    ).on;
  }

  static assertMetadata(metadata: MiotEndpointConnectionMetadata): void {
    getValidatedMiotEndpointProperties(
      'dehumidifier',
      metadata,
      MIOT_DEHUMIDIFIER_ENDPOINT_MATCHERS,
    );
  }

  override async processCommand(
    command: DehumidifierEndpointCommand,
  ): Promise<void> {
    await this.executeRequest(
      createMiotDehumidifierRequest(command, this.metadata, this.onProperty),
    );
  }
}

export const miotDehumidifierEndpointAdapter = defineMiotEndpointAdapter<
  DehumidifierEndpointCommand,
  DehumidifierEndpointConnection
>({
  type: 'dehumidifier',
  Endpoint: MiotDehumidifierEndpointConnection.Endpoint,
  Connection: MiotDehumidifierEndpointConnection,
  endpointMatchers: MiotDehumidifierEndpointConnection.endpointMatchers,
});

type MiotDehumidifierEndpointMatcher = MiotEndpointMatcher<{
  readonly on: MiotPropertyMatcher;
}>;

function createMiotDehumidifierRequest(
  command: DehumidifierEndpointCommand,
  metadata: MiotEndpointConnectionMetadata,
  onProperty: MiotSpecProperty,
): MiotExecutionRequest {
  if (command instanceof SetDehumidifierOnCommand) {
    return new MiotSetPropertyRequest(
      {
        did: metadata.device.did,
        siid: metadata.service.iid,
        piid: onProperty.iid,
      },
      command.value,
    );
  }

  throw new TypeError('Unsupported MIoT dehumidifier endpoint command.');
}
