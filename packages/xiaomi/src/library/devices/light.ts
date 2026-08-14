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

import {
  MiotCommandEffect,
  type MiotCommandEffectConnection,
  type MiotCommandEffectValues,
} from './command-effect.js';

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
        name: 'colorTemperature',
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
    const value = this.getNumberPropertyState('brightness', 0);

    return value === undefined ? undefined : value / maximum;
  }

  @computed
  get colorTemperature(): number | undefined {
    const {colorTemperature} = this.properties;

    if (colorTemperature === undefined) {
      return undefined;
    }

    const valueRange = this.getPropertyValueRange(colorTemperature);
    const [minimum] = valueRange;
    return this.getNumberPropertyState('colorTemperature', minimum);
  }

  override prepareCommand(command: LightEndpointCommand): CommandExecution {
    const effect = createMiotLightEffect(command, this, this.properties);
    const {request} = effect;

    return {effect, execute: () => this.executeRequest(request)};
  }
}

type MiotLightEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotLightEndpointConnection.properties
>;

function createMiotLightEffect(
  command: LightEndpointCommand,
  connection: MiotCommandEffectConnection,
  properties: MiotLightEndpointProperties,
): MiotLightCommandEffect {
  if (command instanceof SetLightOnCommand) {
    return new MiotLightCommandEffect(connection, {on: command.value});
  } else if (command instanceof SetLightBrightnessCommand) {
    if (properties.brightness === undefined) {
      throw new CommandError('MIoT light does not support brightness.');
    }

    return new MiotLightCommandEffect(connection, {
      brightness: command.value,
    });
  } else if (command instanceof SetLightColorTemperatureCommand) {
    if (properties.colorTemperature === undefined) {
      throw new CommandError('MIoT light does not support color temperature.');
    }

    return new MiotLightCommandEffect(connection, {
      colorTemperature: command.value,
    });
  }

  throw new TypeError('Unsupported MIoT light endpoint command.');
}

class MiotLightCommandEffect extends MiotCommandEffect<
  LightEndpoint,
  keyof MiotLightEndpointProperties
> {
  protected getValues(
    endpoint: LightEndpoint,
  ): MiotCommandEffectValues<keyof MiotLightEndpointProperties> {
    return {
      on: endpoint.on,
      brightness: endpoint.brightness,
      colorTemperature: endpoint.colorTemperature,
    };
  }
}
