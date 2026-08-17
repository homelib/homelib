import {
  CommandError,
  type CommandExecution,
  FanEndpoint,
  type FanEndpointCommand,
  type FanEndpointConnection,
  type FanMode,
  SetFanHorizontalSwingCommand,
  SetFanModeCommand,
  SetFanOnCommand,
  SetFanSpeedCommand,
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

const FAN_MODE_CODEC = createMiotNamedValueCodec<FanMode>({
  'urn:miot-spec-v2:device:fan:0000A005:zhimi-*': {
    natural: 0,
    normal: 1,
  },
  '*': {
    normal: 0,
    natural: 1,
  },
});

const FAN_SPEED_CODEC: MiotPropertyValueCodec<number, number> = {
  resolve({property}) {
    const valueList = property['value-list'];

    if (!isValidMiotSpecValueList(valueList)) {
      return undefined;
    }

    const levels = valueList
      .map(entry => entry.value)
      .toSorted((left, right) => left - right);

    return {
      decode(raw) {
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          return undefined;
        }

        const index = levels.indexOf(raw);
        return index < 0 ? undefined : (index + 1) / levels.length;
      },
      encode(value) {
        if (!Number.isFinite(value) || value <= 0 || value > 1) {
          throw new CommandError('Unsupported MIoT normalized fan speed.');
        }

        const index = Math.min(
          levels.length - 1,
          Math.max(0, Math.round(value * levels.length) - 1),
        );
        return encodeMiotPropertyValue(property, levels[index]);
      },
    };
  },
};

export class MiotFanEndpointConnection
  extends MiotEndpointConnection<
    FanEndpointCommand,
    typeof MiotFanEndpointConnection.properties
  >
  implements FanEndpointConnection
{
  static readonly Endpoint = FanEndpoint;
  static readonly properties = {
    'urn:miot-spec-v2:service:fan:00007808': {
      'urn:miot-spec-v2:property:on:00000006': 'on',
      'urn:miot-spec-v2:property:mode:00000008': {
        name: 'mode',
        optional: true,
      },
      'urn:miot-spec-v2:property:fan-level:00000016': {
        name: 'fan-level',
        optional: true,
      },
      'urn:miot-spec-v2:property:horizontal-swing:00000017': {
        name: 'horizontal-swing',
        optional: true,
      },
    },
  } as const satisfies MiotPropertySchema;

  private readonly modeCodec = this.getPropertyValueCodec(
    'mode',
    FAN_MODE_CODEC,
  );

  private readonly speedCodec = this.getPropertyValueCodec(
    'fan-level',
    FAN_SPEED_CODEC,
  );

  @computed
  get on(): boolean {
    return this.getBooleanPropertyState('on', false);
  }

  @computed
  get mode(): FanMode | undefined {
    return this.modeCodec?.read();
  }

  @computed
  get speed(): number | undefined {
    const {speedCodec: codec} = this;

    if (codec === undefined) {
      return undefined;
    }

    const raw = this.getNumberPropertyState('fan-level');
    return raw === undefined ? 0 : codec.read();
  }

  @computed
  get horizontalSwing(): boolean | undefined {
    return this.getBooleanPropertyState('horizontal-swing', false);
  }

  override prepareCommand(command: FanEndpointCommand): CommandExecution {
    let effect: MiotFanCommandEffect;

    if (command instanceof SetFanOnCommand) {
      effect = new MiotFanCommandEffect(this, {
        on: encodeMiotPropertyValue(this.properties.on, command.value),
      });
    } else if (command instanceof SetFanModeCommand) {
      const {modeCodec: codec} = this;

      if (codec === undefined) {
        throw new CommandError('MIoT fan does not support mode.');
      }

      const value = codec.encode(command.value);
      effect = new MiotFanCommandEffect(
        this,
        {mode: value},
        {mode: command.value},
      );
    } else if (command instanceof SetFanSpeedCommand) {
      const {speedCodec: codec} = this;

      if (codec === undefined) {
        throw new CommandError('MIoT fan does not support speed.');
      }

      const value = codec.encode(command.value);
      effect = new MiotFanCommandEffect(this, {'fan-level': value});
    } else if (command instanceof SetFanHorizontalSwingCommand) {
      if (this.properties['horizontal-swing'] === undefined) {
        throw new CommandError('MIoT fan does not support horizontal swing.');
      }

      effect = new MiotFanCommandEffect(this, {
        'horizontal-swing': encodeMiotPropertyValue(
          this.properties['horizontal-swing'],
          command.value,
        ),
      });
    } else {
      throw new TypeError('Unsupported MIoT fan endpoint command.');
    }

    const {request} = effect;

    return {
      effect,
      execute: () => this.executeRequest(request),
      toLogString: () => effect.toLogString(),
    };
  }
}

type MiotFanEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotFanEndpointConnection.properties
>;

class MiotFanCommandEffect extends MiotCommandEffect<
  keyof MiotFanEndpointProperties
> {}
