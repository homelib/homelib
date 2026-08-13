import {
  CommandError,
  type CommandExecution,
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
  type MiotEndpointProfile,
  defineMiotEndpointAdapter,
  getMiotEndpointConnectionProperties,
} from '../endpoint-adapter.js';
import {
  MiotEndpointConnection,
  type MiotEndpointConnectionResolvedMetadata,
  type MiotEndpointConnectionTransports,
} from '../endpoint-connection.js';
import {
  type MiotEndpointMatcher,
  type MiotPropertyMatcher,
  type MiotSpecProperty,
} from '../miot/index.js';
import type {MiotProvider} from '../provider.js';

import {
  MiotCommandEffect,
  type MiotCommandEffectConnection,
  type MiotCommandEffectValues,
} from './command-effect.js';

const MiotFanOn = x.boolean;
const MiotFanHorizontalSwing = x.boolean;

const MIOT_FAN_ENDPOINT_MATCHER: MiotFanEndpointMatcher = {
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

const MIOT_FAN_ENDPOINT_PROFILES = [
  {services: [MIOT_FAN_ENDPOINT_MATCHER]},
] as const satisfies readonly MiotEndpointProfile[];

export class MiotFanEndpointConnection
  extends MiotEndpointConnection<FanEndpointCommand>
  implements FanEndpointConnection
{
  static readonly Endpoint = FanEndpoint;

  static readonly endpointProfiles = MIOT_FAN_ENDPOINT_PROFILES;

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
    metadata: MiotEndpointConnectionResolvedMetadata,
    transports: MiotEndpointConnectionTransports,
  ) {
    super(provider, metadata, transports);
    this.properties =
      getMiotEndpointConnectionProperties<MiotFanEndpointProperties>(metadata);
  }

  override prepareCommand(command: FanEndpointCommand): CommandExecution {
    const effect = createMiotFanEffect(command, this, this.properties);
    const {request} = effect;

    return {effect, execute: () => this.executeRequest(request)};
  }
}

export const miotFanEndpointAdapter = defineMiotEndpointAdapter<
  FanEndpointCommand,
  FanEndpointConnection
>({
  type: 'fan',
  Endpoint: MiotFanEndpointConnection.Endpoint,
  Connection: MiotFanEndpointConnection,
  endpointProfiles: MiotFanEndpointConnection.endpointProfiles,
});

type MiotFanEndpointMatcher = Omit<
  MiotEndpointMatcher<
    {
      readonly on: MiotPropertyMatcher;
    },
    {
      readonly windMode: MiotPropertyMatcher;
      readonly speed: MiotPropertyMatcher;
      readonly horizontalSwing: MiotPropertyMatcher;
    }
  >,
  'device'
>;

type MiotFanEndpointProperties = {
  readonly on: MiotSpecProperty;
  readonly windMode?: MiotSpecProperty;
  readonly speed?: MiotSpecProperty;
  readonly horizontalSwing?: MiotSpecProperty;
};

function createMiotFanEffect(
  command: FanEndpointCommand,
  connection: MiotCommandEffectConnection,
  properties: MiotFanEndpointProperties,
): MiotFanCommandEffect {
  if (command instanceof SetFanOnCommand) {
    return new MiotFanCommandEffect(connection, {on: command.value});
  } else if (command instanceof SetFanWindModeCommand) {
    if (properties.windMode === undefined) {
      throw new CommandError('MIoT fan does not support wind mode.');
    }

    return new MiotFanCommandEffect(connection, {
      windMode: getMiotFanWindMode(command.value),
    });
  } else if (command instanceof SetFanSpeedCommand) {
    if (properties.speed === undefined) {
      throw new CommandError('MIoT fan does not support speed.');
    }

    return new MiotFanCommandEffect(connection, {speed: command.value});
  } else if (command instanceof SetFanHorizontalSwingCommand) {
    if (properties.horizontalSwing === undefined) {
      throw new CommandError('MIoT fan does not support horizontal swing.');
    }

    return new MiotFanCommandEffect(connection, {
      horizontalSwing: command.value,
    });
  }

  throw new TypeError('Unsupported MIoT fan endpoint command.');
}

class MiotFanCommandEffect extends MiotCommandEffect<
  FanEndpoint,
  keyof MiotFanEndpointProperties
> {
  protected getValues(
    endpoint: FanEndpoint,
  ): MiotCommandEffectValues<keyof MiotFanEndpointProperties> {
    return {
      on: endpoint.on,
      windMode:
        endpoint.windMode === undefined
          ? undefined
          : getMiotFanWindMode(endpoint.windMode),
      speed: endpoint.speed,
      horizontalSwing: endpoint.horizontalSwing,
    };
  }
}

function getMiotFanWindMode(mode: FanWindMode): number {
  return mode === 'normal' ? 0 : 1;
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
