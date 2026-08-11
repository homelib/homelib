import {
  LightEndpoint,
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
  findMiotEndpointMatches,
} from '../miot/index.js';
import type {MiotProvider} from '../provider.js';

const MiotLightOn = x.union([x.boolean, x.undefined]);

const MIOT_LIGHT_ENDPOINT_MATCHER: MiotLightEndpointMatcher = {
  service: 'urn:miot-spec-v2:service:light:00007802',
  properties: {
    on: {
      type: 'urn:miot-spec-v2:property:on:00000006',
      format: 'bool',
      access: ['read', 'write', 'notify'],
    },
  },
};

const MIOT_LIGHT_ENDPOINT_MATCHERS = [
  MIOT_LIGHT_ENDPOINT_MATCHER,
] as const satisfies readonly MiotLightEndpointMatcher[];

export class MiotLightEndpointConnection
  extends MiotEndpointConnection<LightEndpointCommand>
  implements LightEndpointConnection
{
  static readonly Endpoint = LightEndpoint;

  static readonly endpointMatchers = MIOT_LIGHT_ENDPOINT_MATCHERS;

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
    this.onProperty = getValidatedOnProperty(metadata);
  }

  static assertMetadata(metadata: MiotEndpointConnectionMetadata): void {
    getValidatedOnProperty(metadata);
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

function getValidatedOnProperty(
  metadata: MiotEndpointConnectionMetadata,
): MiotSpecProperty {
  const onProperty = getOnProperty(metadata);

  if (
    Object.keys(metadata.properties).length !== 1 ||
    !Object.hasOwn(metadata.properties, 'on')
  ) {
    throw new TypeError(
      'MIoT light endpoint metadata must contain only the on property.',
    );
  }

  const spec = {
    type: metadata.device.urn,
    description: metadata.device.model,
    services: [metadata.service],
  };
  const matches = MIOT_LIGHT_ENDPOINT_MATCHERS.flatMap(matcher =>
    findMiotEndpointMatches(spec, matcher),
  );
  const valid = matches.some(
    match =>
      match.service.iid === metadata.service.iid &&
      propertiesEqual(match.properties.on, onProperty),
  );

  if (!valid) {
    throw new TypeError('Invalid MIoT light endpoint metadata.');
  }

  return onProperty;
}

function propertiesEqual(
  left: MiotSpecProperty,
  right: MiotSpecProperty,
): boolean {
  return (
    left.iid === right.iid &&
    left.type === right.type &&
    left.format === right.format &&
    uniqueStringArraysEqual(left.access, right.access)
  );
}

function uniqueStringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    leftSet.isSubsetOf(rightSet)
  );
}
