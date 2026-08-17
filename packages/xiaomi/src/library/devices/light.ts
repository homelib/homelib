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
  isValidMiotSpecValueRange,
} from '../miot/index.js';

import {type MiotPropertyValueCodec} from './@value-codec.js';
import {MiotCommandEffect, encodeMiotPropertyValue} from './command-effect.js';

const BRIGHTNESS_CODEC: MiotPropertyValueCodec<number, number> = {
  resolve({property}) {
    const valueRange = property['value-range'];

    if (
      !isValidMiotSpecValueRange(valueRange, property.format) ||
      valueRange[1] <= 0
    ) {
      return undefined;
    }

    const maximum = valueRange[1];

    return {
      decode(raw) {
        return typeof raw === 'number' && Number.isFinite(raw)
          ? raw / maximum
          : undefined;
      },
      encode(value) {
        return encodeMiotPropertyValue(property, value * maximum);
      },
    };
  },
};

const NUMBER_PROPERTY_CODEC: MiotPropertyValueCodec<number, number> = {
  resolve({property}) {
    return {
      decode(raw) {
        return typeof raw === 'number' && Number.isFinite(raw)
          ? raw
          : undefined;
      },
      encode(value) {
        return encodeMiotPropertyValue(property, value);
      },
    };
  },
};

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

  private readonly brightnessCodec = this.getPropertyValueCodec(
    'brightness',
    BRIGHTNESS_CODEC,
  );

  private readonly colorTemperatureCodec = this.getPropertyValueCodec(
    'color-temperature',
    NUMBER_PROPERTY_CODEC,
  );

  @computed
  get on(): boolean {
    return this.getBooleanPropertyState('on', false);
  }

  @computed
  get brightness(): number | undefined {
    return this.brightnessCodec?.read();
  }

  @computed
  get colorTemperature(): number | undefined {
    return this.colorTemperatureCodec?.read();
  }

  override prepareCommand(command: LightEndpointCommand): CommandExecution {
    let effect: MiotLightCommandEffect;

    if (command instanceof SetLightOnCommand) {
      effect = new MiotLightCommandEffect(this, {
        on: encodeMiotPropertyValue(this.properties.on, command.value),
      });
    } else if (command instanceof SetLightBrightnessCommand) {
      const {brightnessCodec: codec} = this;

      if (codec === undefined) {
        throw new CommandError('MIoT light does not support brightness.');
      }

      effect = new MiotLightCommandEffect(this, {
        brightness: codec.encode(command.value),
      });
    } else if (command instanceof SetLightColorTemperatureCommand) {
      const {colorTemperatureCodec: codec} = this;

      if (codec === undefined) {
        throw new CommandError(
          'MIoT light does not support color temperature.',
        );
      }

      effect = new MiotLightCommandEffect(this, {
        'color-temperature': codec.encode(command.value),
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
