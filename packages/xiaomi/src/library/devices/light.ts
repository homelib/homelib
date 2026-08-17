import {
  CommandError,
  type CommandExecution,
  LightEndpoint,
  type LightEndpointCommand,
  type LightEndpointConnection,
  SetLightBrightnessCommand,
  SetLightColorTemperatureCommand,
  SetLightOnCommand,
} from '@homelib/core';
import {computed} from 'mobx';

import {MiotEndpointConnection} from '../endpoint-connection.js';
import {
  type MiotPropertySchema,
  type MiotPropertySchemaProperties,
} from '../miot/index.js';

import {MiotCommandEffect} from './command-effect.js';

export class MiotLightEndpointConnection
  extends MiotEndpointConnection<
    LightEndpointCommand,
    typeof MiotLightEndpointConnection.properties
  >
  implements LightEndpointConnection
{
  static readonly Endpoint = LightEndpoint;
  static readonly properties = {
    'urn:miot-spec-v2:service:light:00007802': {
      'urn:miot-spec-v2:property:on:00000006': 'on',
      'urn:miot-spec-v2:property:brightness:0000000D': {
        name: 'brightness',
        optional: true,
      },
      'urn:miot-spec-v2:property:color-temperature:0000000F': {
        name: 'color-temperature',
        optional: true,
      },
    },
  } as const satisfies MiotPropertySchema;

  @computed
  get on(): boolean {
    return this.getBooleanPropertyState('on', false);
  }

  @computed
  get brightness(): number | undefined {
    const {brightness} = this.properties;

    if (brightness === undefined) {
      return undefined;
    }

    const valueRange = this.getPropertyValueRange(brightness);
    const [, maximum] = valueRange;
    const value = this.getNumberPropertyState('brightness');

    return value === undefined ? undefined : value / maximum;
  }

  @computed
  get colorTemperature(): number | undefined {
    const colorTemperature = this.properties['color-temperature'];

    if (colorTemperature === undefined) {
      return undefined;
    }

    return this.getNumberPropertyState('color-temperature');
  }

  override prepareCommand(command: LightEndpointCommand): CommandExecution {
    let effect: MiotLightCommandEffect;

    if (command instanceof SetLightOnCommand) {
      effect = new MiotLightCommandEffect(this, {on: command.value});
    } else if (command instanceof SetLightBrightnessCommand) {
      if (this.properties.brightness === undefined) {
        throw new CommandError('MIoT light does not support brightness.');
      }

      effect = new MiotLightCommandEffect(this, {
        brightness: command.value,
      });
    } else if (command instanceof SetLightColorTemperatureCommand) {
      if (this.properties['color-temperature'] === undefined) {
        throw new CommandError(
          'MIoT light does not support color temperature.',
        );
      }

      effect = new MiotLightCommandEffect(this, {
        'color-temperature': command.value,
      });
    } else {
      throw new TypeError('Unsupported MIoT light endpoint command.');
    }

    const {request} = effect;

    return {
      effect,
      execute: () => this.executeRequest(request),
      toLogString: () => effect.toLogString(),
    };
  }
}

type MiotLightEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotLightEndpointConnection.properties
>;

class MiotLightCommandEffect extends MiotCommandEffect<
  keyof MiotLightEndpointProperties
> {}
