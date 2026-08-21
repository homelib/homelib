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

import {MiotCommandEffect} from '../command/index.js';
import {
  MiotEndpointConnection,
  type MiotPropertyValueCodecDefinition,
} from '../endpoint-connection/index.js';
import {
  type MiotPropertySchema,
  type MiotPropertySchemaProperties,
  encodeMiotPropertyValue,
  isValidMiotSpecValueRange,
} from '../miot/index.js';

const BRIGHTNESS_CODEC_DEFINITION: MiotPropertyValueCodecDefinition<
  number,
  number
> = {
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

const NUMBER_PROPERTY_CODEC_DEFINITION: MiotPropertyValueCodecDefinition<
  number,
  number
> = {
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

  private readonly brightnessBinding = this.bindPropertyValue(
    'brightness',
    BRIGHTNESS_CODEC_DEFINITION,
  );

  private readonly colorTemperatureBinding = this.bindPropertyValue(
    'color-temperature',
    NUMBER_PROPERTY_CODEC_DEFINITION,
  );

  @computed
  get on(): boolean {
    return this.getBooleanPropertyState('on', false);
  }

  @computed
  get brightness(): number | undefined {
    return this.brightnessBinding?.read();
  }

  @computed
  get colorTemperature(): number | undefined {
    return this.colorTemperatureBinding?.read();
  }

  override prepareCommand(command: LightEndpointCommand): CommandExecution {
    let effect: MiotLightCommandEffect;

    if (command instanceof SetLightOnCommand) {
      effect = new MiotLightCommandEffect(this, {
        on: encodeMiotPropertyValue(this.properties.on, command.value),
      });
    } else if (command instanceof SetLightBrightnessCommand) {
      const {brightnessBinding: binding} = this;

      if (binding === undefined) {
        throw new CommandError('MIoT light does not support brightness.');
      }

      effect = new MiotLightCommandEffect(this, {
        brightness: binding.encode(command.value),
      });
    } else if (command instanceof SetLightColorTemperatureCommand) {
      const {colorTemperatureBinding: binding} = this;

      if (binding === undefined) {
        throw new CommandError(
          'MIoT light does not support color temperature.',
        );
      }

      effect = new MiotLightCommandEffect(this, {
        'color-temperature': binding.encode(command.value),
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
