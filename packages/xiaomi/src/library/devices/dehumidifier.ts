import {
  CommandError,
  type CommandExecution,
  DehumidifierEndpoint,
  type DehumidifierEndpointCommand,
  type DehumidifierEndpointConnection,
  type DehumidifierMode,
  SetDehumidifierModeCommand,
  SetDehumidifierOnCommand,
  SetDehumidifierTargetRelativeHumidityCommand,
  Temperature,
} from '@homelib/core';
import {computed, observable} from 'mobx';

import {MiotEndpointConnection} from '../endpoint-connection.js';
import {
  type MiotPropertySchema,
  type MiotPropertySchemaProperties,
} from '../miot/index.js';

import {
  type MiotPropertyValueCodec,
  createMiotNamedValueCodec,
} from './@value-codec.js';
import {MiotCommandEffect, encodeMiotPropertyValue} from './command-effect.js';

const DEHUMIDIFIER_MODE_CODEC = createMiotNamedValueCodec<DehumidifierMode>({
  '*': {auto: 0, sleep: 1, laundry: 2},
});

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
      'urn:miot-spec-v2:property:fault:00000009': {
        name: 'fault',
        iid: {
          'urn:miot-spec-v2:device:dehumidifier:0000A02D:xiaomi-13l': 2,
        },
        optional: true,
      },
      'urn:miot-spec-v2:property:mode:00000008': {
        name: 'mode',
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

  private readonly modeCodec = this.getPropertyValueCodec(
    'mode',
    DEHUMIDIFIER_MODE_CODEC,
  );

  private readonly targetRelativeHumidityCodec = this.getPropertyValueCodec(
    'target-humidity',
    TARGET_RELATIVE_HUMIDITY_CODEC,
  );

  @observable private accessor waterTankFullValue: boolean | undefined;

  @computed
  get on(): boolean {
    return this.getBooleanPropertyState('on', false);
  }

  @computed
  get mode(): DehumidifierMode | undefined {
    return this.modeCodec?.read();
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
  get waterTankFull(): boolean | undefined {
    return this.waterTankFullValue;
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

  protected override handlePropertyStateChange(
    name: string,
    value: unknown,
  ): void {
    if (name !== 'fault') {
      return;
    }

    // MIoT exposes one fault code at a time. A different local fault can mask
    // the tank state, so only explicit tank clear/set values replace the last
    // known value (which normally comes from the cloud-first snapshot).
    if (value === 0) {
      this.waterTankFullValue = false;
    } else if (value === 1) {
      this.waterTankFullValue = true;
    }
  }

  protected override shouldReplaySnapshotPropertyNotifications(
    name: string,
  ): boolean {
    return name === 'fault';
  }

  protected override handleStateInvalidated(): void {
    this.waterTankFullValue = undefined;
  }

  protected override handleSnapshotPropertyInvalidated(name: string): void {
    if (name === 'fault') {
      this.waterTankFullValue = undefined;
    }
  }

  override prepareCommand(
    command: DehumidifierEndpointCommand,
  ): CommandExecution {
    let effect: MiotDehumidifierCommandEffect;
    let assertExecutable = (): void => undefined;

    if (command instanceof SetDehumidifierOnCommand) {
      effect = new MiotDehumidifierCommandEffect(this, {
        on: encodeMiotPropertyValue(this.properties.on, command.value),
      });
    } else if (command instanceof SetDehumidifierModeCommand) {
      const {modeCodec: codec} = this;

      if (codec === undefined) {
        throw new CommandError('MIoT dehumidifier does not support mode.');
      }

      effect = new MiotDehumidifierCommandEffect(
        this,
        {mode: codec.encode(command.value)},
        {mode: command.value},
      );
    } else if (
      command instanceof SetDehumidifierTargetRelativeHumidityCommand
    ) {
      const {targetRelativeHumidityCodec: codec} = this;

      if (codec === undefined) {
        throw new CommandError(
          'MIoT dehumidifier does not support target humidity.',
        );
      }

      effect = new MiotDehumidifierCommandEffect(this, {
        'target-humidity': codec.encode(command.relativeHumidity),
      });
      assertExecutable = () => {
        if (this.waterTankFull === true) {
          throw new CommandError(
            'Cannot set MIoT dehumidifier target humidity while its water tank is full or unavailable.',
          );
        }
      };
    } else {
      throw new TypeError('Unsupported MIoT dehumidifier endpoint command.');
    }

    const {request} = effect;

    return {
      effect,
      execute: () => {
        assertExecutable();
        return this.executeRequest(request);
      },
      toLogString: () => effect.toLogString(),
    };
  }
}

type MiotDehumidifierEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotDehumidifierEndpointConnection.properties
>;

class MiotDehumidifierCommandEffect extends MiotCommandEffect<
  keyof MiotDehumidifierEndpointProperties
> {}
