import {
  Light,
  type LightEndpointCommand,
  type LightEndpointConnection,
  SetLightOnCommand,
} from '@homelib/core';
import {computed} from 'mobx';
import * as x from 'x-value';

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

const MiotLightOn = x.union([x.boolean, x.undefined]);

const MIOT_LIGHT_ENDPOINT_MATCHER: MiotLightEndpointMatcher = {
  service: 'urn:miot-spec-v2:service:light:00007802',
  properties: {
    on: {
      type: 'urn:miot-spec-v2:property:on:00000006',
      access: ['read', 'write', 'notify'],
    },
  },
};

const MIOT_LIGHT_ENDPOINT_MATCHERS = [MIOT_LIGHT_ENDPOINT_MATCHER];

export class MiotLight extends Light {
  static get endpointMatchers(): readonly MiotLightEndpointMatcher[] {
    return MIOT_LIGHT_ENDPOINT_MATCHERS;
  }
}

export class MiotLightEndpointConnection
  extends MiotEndpointConnection<LightEndpointCommand>
  implements LightEndpointConnection
{
  private readonly onProperty: MiotSpecProperty;

  @computed
  get on(): boolean | undefined {
    return MiotLightOn.satisfies(this.getState('on'));
  }

  constructor(
    provider: MiotProvider,
    metadata: MiotEndpointConnectionMetadata,
    transports: MiotEndpointConnectionTransports,
  ) {
    super(provider, metadata, transports);
    this.onProperty = getOnProperty(metadata);
  }

  static assertMetadata(metadata: MiotEndpointConnectionMetadata): void {
    getOnProperty(metadata);
  }

  override async processCommand(command: LightEndpointCommand): Promise<void> {
    await this.executeRequest(
      createMiotLightRequest(command, this.metadata, this.onProperty),
    );
  }
}

type MiotLightEndpointMatcher = MiotEndpointMatcher<{
  readonly on: MiotPropertyMatcher;
}>;

function createMiotLightRequest(
  command: LightEndpointCommand,
  metadata: MiotEndpointConnectionMetadata,
  onProperty: MiotSpecProperty,
): MiotExecutionRequest {
  if (command instanceof SetLightOnCommand) {
    return new MiotSetPropertyRequest(
      {
        did: metadata.device.did,
        siid: metadata.service.iid,
        piid: onProperty.iid,
      },
      command.value,
    );
  }

  throw new TypeError('Unsupported MIoT light endpoint command.');
}

function getOnProperty(
  metadata: MiotEndpointConnectionMetadata,
): MiotSpecProperty {
  const property = metadata.properties.on;

  if (property === undefined) {
    throw new TypeError('MIoT light endpoint metadata has no on property.');
  }

  return property;
}
