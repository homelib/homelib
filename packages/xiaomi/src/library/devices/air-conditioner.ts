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
} from '../miot/index.js';

import {MiotCommandEffect} from './command-effect.js';

const AIR_CONDITIONER_MODES: ReadonlySet<string> = new Set([
  'auto',
  'cool',
  'dry',
  'fan',
  'heat',
]);

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
        enum: {'*': {cool: 2, dry: 3, fan: 4, heat: 5, off: 6}},
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
        enum: {
          'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-mt*': {
            auto: 0,
          },
          'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-rr6r00': {
            auto: 0,
          },
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

  @computed
  get on(): boolean {
    return this.getBooleanPropertyState('on', false);
  }

  @computed
  get mode(): AirConditionerMode | undefined {
    const mode = this.getEnumPropertyState('mode');
    return mode === 'off' ? undefined : mode;
  }

  @computed
  get fanSpeed(): AirConditionerFanSpeed | undefined {
    const property = this.properties['fan-level'];

    if (property === undefined) {
      return undefined;
    }

    const value = this.getNumberPropertyState('fan-level');

    if (value === undefined) {
      return undefined;
    }

    if (value === property.enum.auto) {
      return 'auto';
    }

    const enumValues = new Set<number>(Object.values(property.enum));
    const levels = this.getPropertyValueList(property)
      .map(entry => entry.value)
      .filter(level => !enumValues.has(level))
      .toSorted((left, right) => left - right);
    const levelIndex = levels.indexOf(value);

    if (levelIndex < 0) {
      throw new TypeError(`Unknown MIoT fan-level property state: ${value}.`);
    }

    return levels.length === 1 ? 0 : levelIndex / (levels.length - 1);
  }

  @computed
  get targetTemperature(): Temperature | undefined {
    return this.getTemperaturePropertyState(
      'target-temperature',
      Temperature.fromKelvin(0),
    );
  }

  @computed
  get targetRelativeHumidity(): number | undefined {
    const value = this.getNumberPropertyState('target-humidity', 0);
    return value === undefined ? undefined : value / 100;
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
        on: command.value,
      });
    } else if (command instanceof SetAirConditionerModeCommand) {
      if (this.properties.mode === undefined) {
        throw new CommandError('MIoT air conditioner does not support mode.');
      }

      if (!AIR_CONDITIONER_MODES.has(command.value)) {
        throw new CommandError(
          `Unsupported air conditioner mode: ${String(command.value)}.`,
        );
      }

      effect = new MiotAirConditionerCommandEffect(this, {
        mode: command.value,
      });
    } else if (command instanceof SetAirConditionerFanSpeedCommand) {
      if (this.properties['fan-level'] === undefined) {
        throw new CommandError(
          'MIoT air conditioner does not support fan speed.',
        );
      }

      effect = new MiotAirConditionerCommandEffect(this, {
        'fan-level': command.value,
      });
    } else if (command instanceof SetAirConditionerTargetTemperatureCommand) {
      if (this.properties['target-temperature'] === undefined) {
        throw new CommandError(
          'MIoT air conditioner does not support target temperature.',
        );
      }

      effect = new MiotAirConditionerCommandEffect(this, {
        'target-temperature': command.value,
      });
    } else if (
      command instanceof SetAirConditionerTargetRelativeHumidityCommand
    ) {
      if (this.properties['target-humidity'] === undefined) {
        throw new CommandError(
          'MIoT air conditioner does not support target humidity.',
        );
      }

      effect = new MiotAirConditionerCommandEffect(this, {
        'target-humidity': command.relativeHumidity,
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
