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
  type MiotCommandEffectConnection,
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
        enum: {cool: 2, dry: 3, fan: 4, heat: 5},
        optional: true,
      },
      'urn:miot-spec-v2:property:target-temperature:00000021': {
        name: 'targetTemperature',
        optional: true,
      },
      'urn:miot-spec-v2:property:target-humidity:00000022': {
        name: 'targetRelativeHumidity',
        optional: true,
      },
    },
    'urn:miot-spec-v2:service:environment:0000780A': {
      'urn:miot-spec-v2:property:temperature:00000020': {
        name: 'temperature',
        optional: true,
      },
      'urn:miot-spec-v2:property:relative-humidity:0000000C': {
        name: 'relativeHumidity',
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
      'targetTemperature',
      Temperature.fromKelvin(0),
    );
  }

  @computed
  get targetRelativeHumidity(): number | undefined {
    const value = this.getNumberPropertyState('targetRelativeHumidity', 0);
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
    const value = this.getNumberPropertyState('relativeHumidity', 0);
    return value === undefined ? undefined : value / 100;
  }

  override prepareCommand(
    command: AirConditionerEndpointCommand,
  ): CommandExecution {
    const effect = createMiotAirConditionerEffect(
      command,
      this,
      this.properties,
    );
    const {request} = effect;

    return {effect, execute: () => this.executeRequest(request)};
  }
}

type MiotAirConditionerEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotAirConditionerEndpointConnection.properties
>;

function createMiotAirConditionerEffect(
  command: AirConditionerEndpointCommand,
  connection: MiotCommandEffectConnection,
  properties: MiotAirConditionerEndpointProperties,
): MiotAirConditionerCommandEffect {
  if (command instanceof SetAirConditionerOnCommand) {
    return new MiotAirConditionerCommandEffect(connection, {
      on: command.value,
    });
  } else if (command instanceof SetAirConditionerModeCommand) {
    if (properties.mode === undefined) {
      throw new CommandError('MIoT air conditioner does not support mode.');
    }

    return new MiotAirConditionerCommandEffect(connection, {
      mode: command.value,
    });
  } else if (command instanceof SetAirConditionerTargetTemperatureCommand) {
    if (properties.targetTemperature === undefined) {
      throw new CommandError(
        'MIoT air conditioner does not support target temperature.',
      );
    }

    return new MiotAirConditionerCommandEffect(connection, {
      targetTemperature: command.value,
    });
  } else if (command instanceof SetAirConditionerTargetHumidityCommand) {
    if (properties.targetRelativeHumidity === undefined) {
      throw new CommandError(
        'MIoT air conditioner does not support target humidity.',
      );
    }

    return new MiotAirConditionerCommandEffect(connection, {
      targetRelativeHumidity: command.relativeHumidity,
    });
  }

  throw new TypeError('Unsupported MIoT air conditioner endpoint command.');
}

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
      targetTemperature: endpoint.targetTemperature,
      targetRelativeHumidity: endpoint.targetRelativeHumidity,
    };
  }
}
