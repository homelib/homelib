import {
  AirConditionerEndpoint,
  type AirConditionerEndpointCommand,
  type AirConditionerEndpointConnection,
  type AirConditionerMode,
  CommandError,
  type CommandExecution,
  SetAirConditionerModeCommand,
  SetAirConditionerOnCommand,
  SetAirConditionerTargetHumidityCommand,
  SetAirConditionerTargetTemperatureCommand,
  Temperature,
} from '@homelib/core';
import {computed} from 'mobx';

import {MiotEndpointConnection} from '../endpoint-connection.js';
import {
  type MiotPropertySchema,
  type MiotPropertySchemaProperties,
} from '../miot/index.js';

import {
  MiotCommandEffect,
  type MiotCommandEffectValues,
} from './command-effect.js';

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
        enum: {'*': {cool: 2, dry: 3, fan: 4, heat: 5}},
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
    return this.getEnumPropertyState('mode', 'cool');
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

      effect = new MiotAirConditionerCommandEffect(this, {
        mode: command.value,
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
    } else if (command instanceof SetAirConditionerTargetHumidityCommand) {
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

    return {effect, execute: () => this.executeRequest(request)};
  }
}

type MiotAirConditionerEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotAirConditionerEndpointConnection.properties
>;

class MiotAirConditionerCommandEffect extends MiotCommandEffect<
  AirConditionerEndpoint,
  keyof MiotAirConditionerEndpointProperties
> {
  protected getValues(
    endpoint: AirConditionerEndpoint,
  ): MiotCommandEffectValues<keyof MiotAirConditionerEndpointProperties> {
    return {
      on: endpoint.on,
      mode: endpoint.mode,
      'target-temperature': endpoint.targetTemperature,
      'target-humidity': endpoint.targetRelativeHumidity,
    };
  }
}
