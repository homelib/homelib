import {
  CommandError,
  type CommandExecution,
  FanEndpoint,
  type FanEndpointCommand,
  type FanEndpointConnection,
  type FanMode,
  SetFanHorizontalSwingCommand,
  SetFanModeCommand,
  SetFanOnCommand,
  SetFanSpeedCommand,
} from '@homelib/core';
import {computed} from 'mobx';

import {MiotEndpointConnection} from '../endpoint-connection.js';
import {
  type MiotPropertySchema,
  type MiotPropertySchemaProperties,
} from '../miot/index.js';

import {MiotCommandEffect} from './command-effect.js';

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
        name: 'mode',
        enum: {
          'urn:miot-spec-v2:device:fan:0000A005:zhimi-*': {
            natural: 0,
            normal: 1,
          },
          '*': {
            normal: 0,
            natural: 1,
          },
        },
        optional: true,
      },
      'urn:miot-spec-v2:property:fan-level:00000016': {
        name: 'fan-level',
        optional: true,
      },
      'urn:miot-spec-v2:property:horizontal-swing:00000017': {
        name: 'horizontal-swing',
        optional: true,
      },
    },
  } as const satisfies MiotPropertySchema;

  @computed
  get on(): boolean {
    return this.getBooleanPropertyState('on', false);
  }

  @computed
  get mode(): FanMode | undefined {
    return this.getEnumPropertyState('mode');
  }

  @computed
  get speed(): number | undefined {
    const fanLevel = this.properties['fan-level'];

    if (fanLevel === undefined) {
      return undefined;
    }

    const valueList = this.getPropertyValueList(fanLevel);
    const levels = valueList
      .map(entry => entry.value)
      .toSorted((left, right) => left - right);
    const value = this.getNumberPropertyState('fan-level');

    if (value === undefined) {
      return 0;
    }

    return (levels.indexOf(value) + 1) / levels.length;
  }

  @computed
  get horizontalSwing(): boolean | undefined {
    return this.getBooleanPropertyState('horizontal-swing', false);
  }

  override prepareCommand(command: FanEndpointCommand): CommandExecution {
    let effect: MiotFanCommandEffect;

    if (command instanceof SetFanOnCommand) {
      effect = new MiotFanCommandEffect(this, {on: command.value});
    } else if (command instanceof SetFanModeCommand) {
      if (this.properties.mode === undefined) {
        throw new CommandError('MIoT fan does not support mode.');
      }

      effect = new MiotFanCommandEffect(this, {mode: command.value});
    } else if (command instanceof SetFanSpeedCommand) {
      if (this.properties['fan-level'] === undefined) {
        throw new CommandError('MIoT fan does not support speed.');
      }

      effect = new MiotFanCommandEffect(this, {'fan-level': command.value});
    } else if (command instanceof SetFanHorizontalSwingCommand) {
      if (this.properties['horizontal-swing'] === undefined) {
        throw new CommandError('MIoT fan does not support horizontal swing.');
      }

      effect = new MiotFanCommandEffect(this, {
        'horizontal-swing': command.value,
      });
    } else {
      throw new TypeError('Unsupported MIoT fan endpoint command.');
    }

    const {request} = effect;

    return {
      effect,
      execute: () => this.executeRequest(request),
      toLogString: () => effect.toLogString(),
    };
  }
}

type MiotFanEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotFanEndpointConnection.properties
>;

class MiotFanCommandEffect extends MiotCommandEffect<
  keyof MiotFanEndpointProperties
> {}
