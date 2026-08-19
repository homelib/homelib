import {
  BathHeaterEndpoint,
  type BathHeaterEndpointCommand,
  type BathHeaterEndpointConnection,
  type BathHeaterMode,
  CommandError,
  type CommandExecution,
  SetBathHeaterBlowingCommand,
  SetBathHeaterHeatingCommand,
  SetBathHeaterModeCommand,
  SetBathHeaterTargetTemperatureCommand,
  SetBathHeaterVentilatingCommand,
  StopBathHeaterCommand,
  Temperature,
} from '@homelib/core';
import {computed} from 'mobx';

import {MiotEndpointConnection} from '../endpoint-connection.js';
import {
  type MiotActionSchema,
  MiotInvokeActionRequest,
  type MiotPropertySchema,
  type MiotPropertySchemaProperties,
  resolveMiotActionSchema,
} from '../miot/index.js';

import {
  type MiotPropertyValueCodec,
  createMiotNamedValueCodec,
} from './@value-codec.js';
import {MiotCommandEffect, encodeMiotPropertyValue} from './command-effect.js';

const BATH_HEATER_MODE_CODEC = createMiotNamedValueCodec<BathHeaterMode>({
  'urn:miot-spec-v2:device:bath-heater:0000A028:yeelink-v5': {
    dry: 1,
    defog: 2,
    'quick-defog': 3,
    'quick-heat': 4,
  },
});

const TEMPERATURE_CODEC: MiotPropertyValueCodec<Temperature, number> = {
  resolve({property}) {
    if (property.unit !== 'celsius') {
      return undefined;
    }

    return {
      decode(raw) {
        return typeof raw === 'number' && Number.isFinite(raw)
          ? Temperature.fromCelsius(raw)
          : undefined;
      },
      encode(value) {
        if (!(value instanceof Temperature)) {
          throw new TypeError('Invalid MIoT bath heater temperature.');
        }

        return encodeMiotPropertyValue(property, value.celsius);
      },
    };
  },
};

export class MiotBathHeaterEndpointConnection
  extends MiotEndpointConnection<
    BathHeaterEndpointCommand,
    typeof MiotBathHeaterEndpointConnection.properties
  >
  implements BathHeaterEndpointConnection
{
  static readonly Endpoint = BathHeaterEndpoint;
  static readonly actions = {
    'urn:miot-spec-v2:service:ptc-bath-heater:0000783B': {
      'urn:miot-spec-v2:action:stop-working:00002825': {in: [], out: []},
    },
  } as const satisfies MiotActionSchema;

  static readonly properties = {
    'urn:miot-spec-v2:service:ptc-bath-heater:0000783B': {
      'urn:miot-spec-v2:property:mode:00000008': {
        name: 'mode',
        iid: {
          'urn:miot-spec-v2:device:bath-heater:0000A028:yeelink-v5': 1,
        },
      },
      'urn:miot-spec-v2:property:heating:000000C7': 'heating',
      'urn:miot-spec-v2:property:blow:000000CD': 'blowing',
      'urn:miot-spec-v2:property:ventilation:000000CE': 'ventilating',
      'urn:miot-spec-v2:property:target-temperature:00000021':
        'target-temperature',
      'urn:miot-spec-v2:property:temperature:00000020': {
        name: 'temperature',
        access: 'read',
      },
    },
  } as const satisfies MiotPropertySchema;

  private readonly modeCodec = this.getPropertyValueCodec(
    'mode',
    BATH_HEATER_MODE_CODEC,
  );

  private readonly targetTemperatureCodec = this.getPropertyValueCodec(
    'target-temperature',
    TEMPERATURE_CODEC,
  );

  private readonly temperatureCodec = this.getPropertyValueCodec(
    'temperature',
    TEMPERATURE_CODEC,
  );

  @computed
  get mode(): BathHeaterMode | undefined {
    return this.modeCodec?.read();
  }

  @computed
  get heating(): boolean {
    return this.getBooleanPropertyState('heating', false);
  }

  @computed
  get blowing(): boolean {
    return this.getBooleanPropertyState('blowing', false);
  }

  @computed
  get ventilating(): boolean {
    return this.getBooleanPropertyState('ventilating', false);
  }

  @computed
  get targetTemperature(): Temperature | undefined {
    return this.targetTemperatureCodec?.read();
  }

  @computed
  get temperature(): Temperature | undefined {
    return this.temperatureCodec?.read();
  }

  override prepareCommand(
    command: BathHeaterEndpointCommand,
  ): CommandExecution {
    if (command instanceof StopBathHeaterCommand) {
      const request = this.createStopRequest();

      return {
        execute: () => this.executeRequest(request),
        toLogString: () => command.toLogString(),
      };
    }

    let effect: MiotBathHeaterCommandEffect;

    if (command instanceof SetBathHeaterModeCommand) {
      const {modeCodec: codec} = this;

      if (codec === undefined) {
        throw new CommandError('MIoT bath heater does not support mode.');
      }

      effect = new MiotBathHeaterCommandEffect(
        this,
        {mode: codec.encode(command.value)},
        {mode: command.value},
      );
    } else if (command instanceof SetBathHeaterHeatingCommand) {
      effect = new MiotBathHeaterCommandEffect(this, {
        heating: encodeMiotPropertyValue(
          this.properties.heating,
          command.value,
        ),
      });
    } else if (command instanceof SetBathHeaterBlowingCommand) {
      effect = new MiotBathHeaterCommandEffect(this, {
        blowing: encodeMiotPropertyValue(
          this.properties.blowing,
          command.value,
        ),
      });
    } else if (command instanceof SetBathHeaterVentilatingCommand) {
      effect = new MiotBathHeaterCommandEffect(this, {
        ventilating: encodeMiotPropertyValue(
          this.properties.ventilating,
          command.value,
        ),
      });
    } else if (command instanceof SetBathHeaterTargetTemperatureCommand) {
      const {targetTemperatureCodec: codec} = this;

      if (codec === undefined) {
        throw new CommandError(
          'MIoT bath heater does not support target temperature.',
        );
      }

      effect = new MiotBathHeaterCommandEffect(this, {
        'target-temperature': codec.encode(command.value),
      });
    } else {
      throw new TypeError('Unsupported MIoT bath heater endpoint command.');
    }

    const {request} = effect;

    return {
      effect,
      execute: () => this.executeRequest(request),
      toLogString: () => effect.toLogString(),
    };
  }

  private createStopRequest(): MiotInvokeActionRequest {
    const [resolvedAction] =
      resolveMiotActionSchema(
        this.metadata.resources,
        MiotBathHeaterEndpointConnection.actions,
      ) ?? [];

    if (
      resolvedAction === undefined ||
      resolvedAction.in.length !== 0 ||
      (resolvedAction.out?.length ?? 0) !== 0
    ) {
      throw new CommandError('MIoT bath heater does not support stopping.');
    }

    return new MiotInvokeActionRequest(
      {
        did: this.metadata.device.did,
        siid: resolvedAction.service.iid,
        aiid: resolvedAction.action.iid,
      },
      [],
    );
  }
}

type MiotBathHeaterEndpointProperties = MiotPropertySchemaProperties<
  typeof MiotBathHeaterEndpointConnection.properties
>;

class MiotBathHeaterCommandEffect extends MiotCommandEffect<
  keyof MiotBathHeaterEndpointProperties
> {}
