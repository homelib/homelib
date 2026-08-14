import {
  CommandError,
  type CommandExecution,
  DehumidifierEndpoint,
  type DehumidifierEndpointCommand,
  type DehumidifierEndpointConnection,
  type DehumidifierMode,
  SetDehumidifierModeCommand,
  SetDehumidifierOnCommand,
  SetDehumidifierTargetHumidityCommand,
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

export class MiotDehumidifierEndpointConnection
  extends MiotEndpointConnection<
    DehumidifierEndpointCommand,
    typeof MiotDehumidifierEndpointConnection.properties
  >
  implements DehumidifierEndpointConnection
{
  static readonly Endpoint = DehumidifierEndpoint;
  static readonly properties = {
    'urn:miot-spec-v2:service:dehumidifier:00007841': {
      'urn:miot-spec-v2:property:on:00000006': 'on',
      'urn:miot-spec-v2:property:mode:00000008': {
        name: 'mode',
        enum: {'*': {auto: 0, sleep: 1, laundry: 2}},
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
  get mode(): DehumidifierMode | undefined {
    return this.getEnumPropertyState('mode', 'auto');
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
    command: DehumidifierEndpointCommand,
  ): CommandExecution {
    const effect = createMiotDehumidifierEffect(command, this, this.properties);
    const {request} = effect;

    return {effect, execute: () => this.executeRequest(request)};
  }
}

type MiotDehumidifierEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotDehumidifierEndpointConnection.properties
>;

function createMiotDehumidifierEffect(
  command: DehumidifierEndpointCommand,
  connection: MiotCommandEffectConnection,
  properties: MiotDehumidifierEndpointProperties,
): MiotDehumidifierCommandEffect {
  if (command instanceof SetDehumidifierOnCommand) {
    return new MiotDehumidifierCommandEffect(connection, {on: command.value});
  } else if (command instanceof SetDehumidifierModeCommand) {
    if (properties.mode === undefined) {
      throw new CommandError('MIoT dehumidifier does not support mode.');
    }

    return new MiotDehumidifierCommandEffect(connection, {
      mode: command.value,
    });
  } else if (command instanceof SetDehumidifierTargetHumidityCommand) {
    if (properties.targetRelativeHumidity === undefined) {
      throw new CommandError(
        'MIoT dehumidifier does not support target humidity.',
      );
    }

    return new MiotDehumidifierCommandEffect(connection, {
      targetRelativeHumidity: command.relativeHumidity,
    });
  }

  throw new TypeError('Unsupported MIoT dehumidifier endpoint command.');
}

class MiotDehumidifierCommandEffect extends MiotCommandEffect<
  DehumidifierEndpoint,
  keyof MiotDehumidifierEndpointProperties
> {
  protected getValues(
    endpoint: DehumidifierEndpoint,
  ): MiotCommandEffectValues<keyof MiotDehumidifierEndpointProperties> {
    return {
      on: endpoint.on,
      mode: endpoint.mode,
      targetRelativeHumidity: endpoint.targetRelativeHumidity,
    };
  }
}
