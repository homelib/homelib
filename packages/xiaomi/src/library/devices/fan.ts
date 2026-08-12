import {
  CommandError,
  FanEndpoint,
  type FanEndpointCommand,
  type FanEndpointConnection,
  type FanWindMode,
  SetFanHorizontalSwingCommand,
  SetFanOnCommand,
  SetFanSpeedCommand,
  SetFanWindModeCommand,
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
  getPrimaryMiotEndpointConnectionResource,
} from '../endpoint-connection.js';
import {
  type MiotEndpointMatcher,
  type MiotExecutionRequest,
  type MiotPropertyMatcher,
  MiotSetPropertyRequest,
  type MiotSpecProperty,
} from '../miot/index.js';
import type {MiotProvider} from '../provider.js';

const MiotFanOn = x.boolean;
const MiotFanHorizontalSwing = x.boolean;

const MIOT_FAN_ENDPOINT_MATCHER: MiotFanEndpointMatcher = {
  device: 'urn:miot-spec-v2:device:fan:0000A005:dmaker-p5c:1',
  service: 'urn:miot-spec-v2:service:fan:00007808',
  properties: {
    on: {
      type: 'urn:miot-spec-v2:property:on:00000006',
      format: 'bool',
      access: ['read', 'write', 'notify'],
    },
  },
  optionalProperties: {
    windMode: {
      type: 'urn:miot-spec-v2:property:mode:00000008',
      format: 'uint8',
      access: ['read', 'write', 'notify'],
      valueList: [0, 1],
    },
    speed: {
      type: 'urn:miot-spec-v2:property:fan-level:00000016',
      format: 'uint8',
      access: ['read', 'write', 'notify'],
      valueList: [1, 2, 3, 4],
    },
    horizontalSwing: {
      type: 'urn:miot-spec-v2:property:horizontal-swing:00000017',
      format: 'bool',
      access: ['read', 'write', 'notify'],
    },
  },
};

const MIOT_FAN_FALLBACK_ENDPOINT_MATCHER: MiotFanEndpointMatcher = {
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
  MIOT_FAN_FALLBACK_ENDPOINT_MATCHER,
] as const satisfies readonly MiotFanEndpointMatcher[];

export class MiotFanEndpointConnection
  extends MiotEndpointConnection<FanEndpointCommand>
  implements FanEndpointConnection
{
  static readonly Endpoint = FanEndpoint;

  static readonly endpointMatchers = MIOT_FAN_ENDPOINT_MATCHERS;

  private readonly properties: MiotFanEndpointProperties;

  @computed
  get on(): boolean {
    const value = this.getState('on');

    return value === undefined ? false : MiotFanOn.satisfies(value);
  }

  @computed
  get windMode(): FanWindMode | undefined {
    if (this.properties.windMode === undefined) {
      return undefined;
    }

    const value = getOptionalNumberState(this.getState('windMode'));

    if (value === undefined) {
      return 'normal';
    }

    switch (value) {
      case 0:
        return 'normal';
      case 1:
        return 'natural';
      default:
        throw new TypeError('Invalid MIoT fan wind mode state.');
    }
  }

  @computed
  get speed(): number | undefined {
    if (this.properties.speed === undefined) {
      return undefined;
    }

    const value = getOptionalNumberState(this.getState('speed'));

    if (value === undefined) {
      return 0;
    }

    if (!Number.isInteger(value) || value < 1 || value > 4) {
      throw new TypeError('Invalid MIoT fan speed state.');
    }

    return value / 4;
  }

  @computed
  get horizontalSwing(): boolean | undefined {
    if (this.properties.horizontalSwing === undefined) {
      return undefined;
    }

    const value = this.getState('horizontalSwing');

    return value === undefined
      ? false
      : MiotFanHorizontalSwing.satisfies(value);
  }

  constructor(
    provider: MiotProvider,
    metadata: MiotEndpointConnectionMetadata,
    transports: MiotEndpointConnectionTransports,
  ) {
    super(provider, metadata, transports);
    this.properties = getValidatedMiotEndpointProperties(
      'fan',
      metadata,
      MIOT_FAN_ENDPOINT_MATCHERS,
    );
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
      createMiotFanRequest(command, this.metadata, this.properties),
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

type MiotFanEndpointMatcher = MiotEndpointMatcher<
  {
    readonly on: MiotPropertyMatcher;
  },
  {
    readonly windMode: MiotPropertyMatcher;
    readonly speed: MiotPropertyMatcher;
    readonly horizontalSwing: MiotPropertyMatcher;
  }
>;

type MiotFanEndpointProperties = {
  readonly on: MiotSpecProperty;
  readonly windMode?: MiotSpecProperty;
  readonly speed?: MiotSpecProperty;
  readonly horizontalSwing?: MiotSpecProperty;
};

function createMiotFanRequest(
  command: FanEndpointCommand,
  metadata: MiotEndpointConnectionMetadata,
  properties: MiotFanEndpointProperties,
): MiotExecutionRequest {
  if (command instanceof SetFanOnCommand) {
    return createSetPropertyRequest(metadata, properties.on, command.value);
  } else if (command instanceof SetFanWindModeCommand) {
    const property = properties.windMode;

    if (property === undefined) {
      throw new CommandError('MIoT fan does not support wind mode.');
    }

    return createSetPropertyRequest(
      metadata,
      property,
      command.value === 'normal' ? 0 : 1,
    );
  } else if (command instanceof SetFanSpeedCommand) {
    const property = properties.speed;

    if (property === undefined) {
      throw new CommandError('MIoT fan does not support speed.');
    }

    const rawValue = Math.min(4, Math.max(1, Math.round(command.value * 4)));

    return createSetPropertyRequest(metadata, property, rawValue);
  } else if (command instanceof SetFanHorizontalSwingCommand) {
    const property = properties.horizontalSwing;

    if (property === undefined) {
      throw new CommandError('MIoT fan does not support horizontal swing.');
    }

    return createSetPropertyRequest(metadata, property, command.value);
  }

  throw new TypeError('Unsupported MIoT fan endpoint command.');
}

function createSetPropertyRequest(
  metadata: MiotEndpointConnectionMetadata,
  property: MiotSpecProperty,
  value: unknown,
): MiotSetPropertyRequest {
  const {service} = getPrimaryMiotEndpointConnectionResource(metadata);

  return new MiotSetPropertyRequest(
    {
      did: metadata.device.did,
      siid: service.iid,
      piid: property.iid,
    },
    value,
  );
}

function getOptionalNumberState(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Invalid MIoT fan numeric state.');
  }

  return value;
}
