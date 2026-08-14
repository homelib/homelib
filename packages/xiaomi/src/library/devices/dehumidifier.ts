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
  get mode(): DehumidifierMode | undefined {
    return this.getEnumPropertyState('mode', 'auto');
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
    command: DehumidifierEndpointCommand,
  ): CommandExecution {
    let effect: MiotDehumidifierCommandEffect;

    if (command instanceof SetDehumidifierOnCommand) {
      effect = new MiotDehumidifierCommandEffect(this, {on: command.value});
    } else if (command instanceof SetDehumidifierModeCommand) {
      if (this.properties.mode === undefined) {
        throw new CommandError('MIoT dehumidifier does not support mode.');
      }

      effect = new MiotDehumidifierCommandEffect(this, {
        mode: command.value,
      });
    } else if (command instanceof SetDehumidifierTargetHumidityCommand) {
      if (this.properties['target-humidity'] === undefined) {
        throw new CommandError(
          'MIoT dehumidifier does not support target humidity.',
        );
      }

      effect = new MiotDehumidifierCommandEffect(this, {
        'target-humidity': command.relativeHumidity,
      });
    } else {
      throw new TypeError('Unsupported MIoT dehumidifier endpoint command.');
    }

    const {request} = effect;

    return {
      effect,
      execute: () => this.executeRequest(request),
      toLogString: () => effect.toLogString(),
    };
  }
}

type MiotDehumidifierEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotDehumidifierEndpointConnection.properties
>;

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
      'target-humidity': endpoint.targetRelativeHumidity,
    };
  }
}
