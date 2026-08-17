import {
  AirConditionerEndpoint,
  type AirConditionerEndpointCommand,
  type AirConditionerEndpointConnection,
  type AirConditionerFanSpeed,
  type AirConditionerMode,
  CommandError,
  type CommandExecution,
  SetAirConditionerFanSpeedCommand,
  SetAirConditionerModeCommand,
  SetAirConditionerOnCommand,
  SetAirConditionerTargetRelativeHumidityCommand,
  SetAirConditionerTargetTemperatureCommand,
  Temperature,
} from '@homelib/core';
import {computed} from 'mobx';

import {MiotEndpointConnection} from '../endpoint-connection.js';
import {
  type MiotPropertySchema,
  type MiotPropertySchemaProperties,
  isValidMiotSpecValueList,
} from '../miot/index.js';

import {
  type MiotPropertyValueCodec,
  createMiotNamedValueCodec,
} from './@value-codec.js';
import {MiotCommandEffect, encodeMiotPropertyValue} from './command-effect.js';

const AIR_CONDITIONER_MODES: ReadonlySet<string> = new Set([
  'auto',
  'cool',
  'dry',
  'fan',
  'heat',
]);

type MiotAirConditionerMode = AirConditionerMode | 'off';

const AIR_CONDITIONER_MODE_CODEC =
  createMiotNamedValueCodec<MiotAirConditionerMode>({
    '*': {cool: 2, dry: 3, fan: 4, heat: 5, off: 6},
  });

const AIR_CONDITIONER_AUTO_FAN_SPEED_CODEC = createMiotNamedValueCodec<'auto'>({
  'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-mt*': {
    auto: 0,
  },
  'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-rr6r00': {
    auto: 0,
  },
});

const AIR_CONDITIONER_FAN_SPEED_CODEC: MiotPropertyValueCodec<
  AirConditionerFanSpeed,
  number
> = {
  resolve(context) {
    const autoCodec = AIR_CONDITIONER_AUTO_FAN_SPEED_CODEC.resolve(context);
    const valueList = context.property['value-list'];

    if (autoCodec === undefined || !isValidMiotSpecValueList(valueList)) {
      return undefined;
    }

    const autoValue = autoCodec.encode('auto');
    const levels = valueList
      .map(entry => entry.value)
      .filter(value => value !== autoValue)
      .toSorted((left, right) => left - right);

    return {
      decode(raw) {
        if (autoCodec.decode(raw) === 'auto') {
          return 'auto';
        }

        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          return undefined;
        }

        const index = levels.indexOf(raw);

        if (index < 0) {
          return undefined;
        }

        return levels.length === 1 ? 0 : index / (levels.length - 1);
      },
      encode(value) {
        if (value === 'auto') {
          return autoValue;
        }

        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 1 ||
          levels.length === 0
        ) {
          throw new CommandError(
            `Unsupported MIoT air conditioner fan speed: ${String(value)}.`,
          );
        }

        const index = Math.min(
          levels.length - 1,
          Math.max(0, Math.round(value * (levels.length - 1))),
        );
        return encodeMiotPropertyValue(context.property, levels[index]);
      },
    };
  },
};

const TARGET_RELATIVE_HUMIDITY_CODEC: MiotPropertyValueCodec<number, number> = {
  resolve({property}) {
    return {
      decode(raw) {
        return typeof raw === 'number' && Number.isFinite(raw)
          ? raw / 100
          : undefined;
      },
      encode(value) {
        return encodeMiotPropertyValue(property, value * 100);
      },
    };
  },
};

const TARGET_TEMPERATURE_CODEC: MiotPropertyValueCodec<Temperature, number> = {
  resolve({property}) {
    const fromRaw =
      property.unit === 'celsius'
        ? Temperature.fromCelsius
        : property.unit === 'fahrenheit'
          ? Temperature.fromFahrenheit
          : property.unit === 'kelvin'
            ? Temperature.fromKelvin
            : undefined;
    const toRaw =
      property.unit === 'celsius'
        ? (value: Temperature): number => value.celsius
        : property.unit === 'fahrenheit'
          ? (value: Temperature): number => value.fahrenheit
          : property.unit === 'kelvin'
            ? (value: Temperature): number => value.kelvin
            : undefined;

    if (fromRaw === undefined || toRaw === undefined) {
      return undefined;
    }

    return {
      decode(raw) {
        return typeof raw === 'number' && Number.isFinite(raw)
          ? fromRaw(raw)
          : undefined;
      },
      encode(value) {
        if (!(value instanceof Temperature)) {
          throw new TypeError('Invalid MIoT target temperature.');
        }

        return encodeMiotPropertyValue(property, toRaw(value));
      },
    };
  },
};

export class MiotAirConditionerEndpointConnection
  extends MiotEndpointConnection<
    AirConditionerEndpointCommand,
    typeof MiotAirConditionerEndpointConnection.properties
  >
  implements AirConditionerEndpointConnection
{
  static readonly Endpoint = AirConditionerEndpoint;
  static readonly properties = {
    'urn:miot-spec-v2:service:air-conditioner:0000780F': {
      'urn:miot-spec-v2:property:on:00000006': 'on',
      'urn:miot-spec-v2:property:mode:00000008': {
        name: 'mode',
        optional: true,
      },
      'urn:miot-spec-v2:property:target-temperature:00000021': {
        name: 'target-temperature',
        optional: true,
      },
      'urn:miot-spec-v2:property:target-humidity:00000022': {
        name: 'target-humidity',
        optional: true,
      },
    },
    'urn:miot-spec-v2:service:fan-control:00007809': {
      'urn:miot-spec-v2:property:fan-level:00000016': {
        name: 'fan-level',
        iid: {
          'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-mt*': 2,
          'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-rr6r00': 2,
        },
        optional: true,
      },
    },
    'urn:miot-spec-v2:service:environment:0000780A': {
      'urn:miot-spec-v2:property:temperature:00000020': {
        name: 'temperature',
        optional: true,
      },
      'urn:miot-spec-v2:property:relative-humidity:0000000C': {
        name: 'relative-humidity',
        optional: true,
      },
    },
  } as const satisfies MiotPropertySchema;

  private readonly modeCodec = this.getPropertyValueCodec(
    'mode',
    AIR_CONDITIONER_MODE_CODEC,
  );

  private readonly fanSpeedCodec = this.getPropertyValueCodec(
    'fan-level',
    AIR_CONDITIONER_FAN_SPEED_CODEC,
  );

  private readonly targetTemperatureCodec = this.getPropertyValueCodec(
    'target-temperature',
    TARGET_TEMPERATURE_CODEC,
  );

  private readonly targetRelativeHumidityCodec = this.getPropertyValueCodec(
    'target-humidity',
    TARGET_RELATIVE_HUMIDITY_CODEC,
  );

  @computed
  get on(): boolean {
    return this.getBooleanPropertyState('on', false);
  }

  @computed
  get mode(): AirConditionerMode | undefined {
    const mode = this.modeCodec?.read();
    return mode === 'off' ? undefined : mode;
  }

  @computed
  get fanSpeed(): AirConditionerFanSpeed | undefined {
    return this.fanSpeedCodec?.read();
  }

  @computed
  get targetTemperature(): Temperature | undefined {
    const {targetTemperatureCodec: codec} = this;

    if (codec === undefined) {
      return undefined;
    }

    const raw = this.getNumberPropertyState('target-temperature');
    return raw === undefined ? Temperature.fromKelvin(0) : codec.read();
  }

  @computed
  get targetRelativeHumidity(): number | undefined {
    const {targetRelativeHumidityCodec: codec} = this;

    if (codec === undefined) {
      return undefined;
    }

    const raw = this.getNumberPropertyState('target-humidity');
    return raw === undefined ? 0 : codec.read();
  }

  @computed
  get temperature(): Temperature | undefined {
    return this.getTemperaturePropertyState(
      'temperature',
      Temperature.fromKelvin(0),
    );
  }

  @computed
  get relativeHumidity(): number | undefined {
    const value = this.getNumberPropertyState('relative-humidity', 0);
    return value === undefined ? undefined : value / 100;
  }

  override prepareCommand(
    command: AirConditionerEndpointCommand,
  ): CommandExecution {
    let effect: MiotAirConditionerCommandEffect;

    if (command instanceof SetAirConditionerOnCommand) {
      effect = new MiotAirConditionerCommandEffect(this, {
        on: encodeMiotPropertyValue(this.properties.on, command.value),
      });
    } else if (command instanceof SetAirConditionerModeCommand) {
      const {modeCodec: codec} = this;

      if (codec === undefined) {
        throw new CommandError('MIoT air conditioner does not support mode.');
      }

      if (!AIR_CONDITIONER_MODES.has(command.value)) {
        throw new CommandError(
          `Unsupported air conditioner mode: ${String(command.value)}.`,
        );
      }

      const value = codec.encode(command.value);
      effect = new MiotAirConditionerCommandEffect(
        this,
        {mode: value},
        {mode: command.value},
      );
    } else if (command instanceof SetAirConditionerFanSpeedCommand) {
      const {fanSpeedCodec: codec} = this;

      if (codec === undefined) {
        throw new CommandError(
          'MIoT air conditioner does not support fan speed.',
        );
      }

      const value = codec.encode(command.value);
      effect = new MiotAirConditionerCommandEffect(
        this,
        {'fan-level': value},
        command.value === 'auto' ? {'fan-level': 'auto'} : {},
      );
    } else if (command instanceof SetAirConditionerTargetTemperatureCommand) {
      const {targetTemperatureCodec: codec} = this;

      if (codec === undefined) {
        throw new CommandError(
          'MIoT air conditioner does not support target temperature.',
        );
      }

      const value = codec.encode(command.value);
      effect = new MiotAirConditionerCommandEffect(this, {
        'target-temperature': value,
      });
    } else if (
      command instanceof SetAirConditionerTargetRelativeHumidityCommand
    ) {
      const {targetRelativeHumidityCodec: codec} = this;

      if (codec === undefined) {
        throw new CommandError(
          'MIoT air conditioner does not support target humidity.',
        );
      }

      const value = codec.encode(command.relativeHumidity);
      effect = new MiotAirConditionerCommandEffect(this, {
        'target-humidity': value,
      });
    } else {
      throw new TypeError('Unsupported MIoT air conditioner endpoint command.');
    }

    const {request} = effect;

    return {
      effect,
      execute: () => this.executeRequest(request),
      toLogString: () => effect.toLogString(),
    };
  }
}

type MiotAirConditionerEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotAirConditionerEndpointConnection.properties
>;

class MiotAirConditionerCommandEffect extends MiotCommandEffect<
  keyof MiotAirConditionerEndpointProperties
> {}
