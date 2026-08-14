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

import {MiotEndpointConnection} from '../endpoint-connection.js';
import {
  type MiotPropertySchema,
  type MiotPropertySchemaProperties,
} from '../miot/index.js';

import {
  MiotCommandEffect,
  type MiotCommandEffectConnection,
  type MiotCommandEffectValues,
} from './command-effect.js';

export class MiotFanEndpointConnection
  extends MiotEndpointConnection<
    FanEndpointCommand,
    typeof MiotFanEndpointConnection.properties
  >
  implements FanEndpointConnection
{
  static readonly Endpoint = FanEndpoint;
  static readonly properties = {
    'urn:miot-spec-v2:service:fan:00007808': {
      'urn:miot-spec-v2:property:on:00000006': 'on',
      'urn:miot-spec-v2:property:mode:00000008': {
        name: 'windMode',
        enum: {
          normal: 0,
          natural: 1,
        },
        optional: true,
      },
      'urn:miot-spec-v2:property:fan-level:00000016': {
        name: 'speed',
        optional: true,
      },
      'urn:miot-spec-v2:property:horizontal-swing:00000017': {
        name: 'horizontalSwing',
        optional: true,
      },
    },
  } as const satisfies MiotPropertySchema;

  @computed
  get on(): boolean {
    return this.getBooleanPropertyState('on', false);
  }

  @computed
  get windMode(): FanWindMode | undefined {
    return this.getEnumPropertyState('windMode', 'normal');
  }

  @computed
  get speed(): number | undefined {
    if (this.properties.speed === undefined) {
      return undefined;
    }

    const valueList = this.getPropertyValueList(this.properties.speed);
    const levels = valueList
      .map(entry => entry.value)
      .toSorted((left, right) => left - right);
    const value = this.getNumberPropertyState('speed');

    if (value === undefined) {
      return 0;
    }

    const index = levels.indexOf(value);

    if (index === -1) {
      throw new TypeError('Invalid MIoT fan speed state.');
    }

    return (index + 1) / levels.length;
  }

  @computed
  get horizontalSwing(): boolean | undefined {
    return this.getBooleanPropertyState('horizontalSwing', false);
  }

  override prepareCommand(command: FanEndpointCommand): CommandExecution {
    const effect = createMiotFanEffect(command, this, this.properties);
    const {request} = effect;

    return {effect, execute: () => this.executeRequest(request)};
  }
}

type MiotFanEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotFanEndpointConnection.properties
>;

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
      windMode: command.value,
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
      windMode: endpoint.windMode,
      speed: endpoint.speed,
      horizontalSwing: endpoint.horizontalSwing,
    };
  }
}
