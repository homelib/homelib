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
import * as x from 'x-value';

import {
  type MiotEndpointProfile,
  defineMiotEndpointAdapter,
  getMiotEndpointConnectionProperties,
} from '../endpoint-adapter.js';
import {
  MiotEndpointConnection,
  type MiotEndpointConnectionResolvedMetadata,
  type MiotEndpointConnectionTransports,
} from '../endpoint-connection.js';
import {
  type MiotEndpointMatcher,
  type MiotPropertyMatcher,
  type MiotSpecProperty,
  type MiotSpecValueRange,
  isValidMiotSpecValueRange,
} from '../miot/index.js';
import type {MiotProvider} from '../provider.js';

import {
  MiotCommandEffect,
  type MiotCommandEffectConnection,
  type MiotCommandEffectValues,
} from './command-effect.js';

const MiotAirConditionerOn = x.boolean;

const MIOT_AIR_CONDITIONER_ENDPOINT_MATCHER: MiotAirConditionerEndpointMatcher =
  {
    service: 'urn:miot-spec-v2:service:air-conditioner:0000780F',
    properties: {
      on: {
        type: 'urn:miot-spec-v2:property:on:00000006',
        format: 'bool',
        access: ['read', 'write', 'notify'],
      },
    },
    optionalProperties: {
      mode: {
        type: 'urn:miot-spec-v2:property:mode:00000008',
        format: 'uint8',
        access: ['read', 'write', 'notify'],
        valueList: [2, 3, 4, 5],
      },
      targetTemperature: {
        type: 'urn:miot-spec-v2:property:target-temperature:00000021',
        format: 'float',
        access: ['read', 'write', 'notify'],
        unit: 'celsius',
        valueRange: true,
      },
      targetRelativeHumidity: {
        type: 'urn:miot-spec-v2:property:target-humidity:00000022',
        format: 'uint8',
        access: ['read', 'write', 'notify'],
        unit: 'percentage',
        valueRange: true,
      },
    },
  };

const MIOT_AIR_CONDITIONER_TEMPERATURE_MATCHER = {
  type: 'urn:miot-spec-v2:property:temperature:00000020',
  format: 'float',
  access: ['read', 'notify'],
  unit: 'celsius',
  valueRange: true,
} as const satisfies MiotPropertyMatcher;

const MIOT_AIR_CONDITIONER_RELATIVE_HUMIDITY_MATCHER = {
  type: 'urn:miot-spec-v2:property:relative-humidity:0000000C',
  format: 'uint8',
  access: ['read', 'notify'],
  unit: 'percentage',
  valueRange: true,
} as const satisfies MiotPropertyMatcher;

const MIOT_AIR_CONDITIONER_ENVIRONMENT_MATCHER = {
  service: 'urn:miot-spec-v2:service:environment:0000780A',
  properties: {
    temperature: MIOT_AIR_CONDITIONER_TEMPERATURE_MATCHER,
    relativeHumidity: MIOT_AIR_CONDITIONER_RELATIVE_HUMIDITY_MATCHER,
  },
};

const MIOT_AIR_CONDITIONER_TEMPERATURE_ENVIRONMENT_MATCHER = {
  service: 'urn:miot-spec-v2:service:environment:0000780A',
  properties: {temperature: MIOT_AIR_CONDITIONER_TEMPERATURE_MATCHER},
  optionalProperties: {
    relativeHumidity: MIOT_AIR_CONDITIONER_RELATIVE_HUMIDITY_MATCHER,
  },
};

const MIOT_AIR_CONDITIONER_RELATIVE_HUMIDITY_ENVIRONMENT_MATCHER = {
  service: 'urn:miot-spec-v2:service:environment:0000780A',
  properties: {
    relativeHumidity: MIOT_AIR_CONDITIONER_RELATIVE_HUMIDITY_MATCHER,
  },
  optionalProperties: {temperature: MIOT_AIR_CONDITIONER_TEMPERATURE_MATCHER},
};

const MIOT_AIR_CONDITIONER_ENDPOINT_PROFILES = [
  {
    services: [
      MIOT_AIR_CONDITIONER_ENDPOINT_MATCHER,
      MIOT_AIR_CONDITIONER_ENVIRONMENT_MATCHER,
    ],
  },
  {
    services: [
      MIOT_AIR_CONDITIONER_ENDPOINT_MATCHER,
      MIOT_AIR_CONDITIONER_TEMPERATURE_ENVIRONMENT_MATCHER,
      MIOT_AIR_CONDITIONER_RELATIVE_HUMIDITY_ENVIRONMENT_MATCHER,
    ],
  },
  {
    services: [
      MIOT_AIR_CONDITIONER_ENDPOINT_MATCHER,
      MIOT_AIR_CONDITIONER_TEMPERATURE_ENVIRONMENT_MATCHER,
    ],
  },
  {
    services: [
      MIOT_AIR_CONDITIONER_ENDPOINT_MATCHER,
      MIOT_AIR_CONDITIONER_RELATIVE_HUMIDITY_ENVIRONMENT_MATCHER,
    ],
  },
  {services: [MIOT_AIR_CONDITIONER_ENDPOINT_MATCHER]},
] as const satisfies readonly MiotEndpointProfile[];

export class MiotAirConditionerEndpointConnection
  extends MiotEndpointConnection<AirConditionerEndpointCommand>
  implements AirConditionerEndpointConnection
{
  static readonly Endpoint = AirConditionerEndpoint;

  static readonly endpointProfiles = MIOT_AIR_CONDITIONER_ENDPOINT_PROFILES;

  private readonly properties: MiotAirConditionerEndpointProperties;

  @computed
  get on(): boolean {
    const value = this.getState('on');

    return value === undefined ? false : MiotAirConditionerOn.satisfies(value);
  }

  @computed
  get mode(): AirConditionerMode | undefined {
    if (this.properties.mode === undefined) {
      return undefined;
    }

    const value = getOptionalNumberState(this.getState('mode'));

    if (value === undefined) {
      return 'cool';
    }

    switch (value) {
      case 2:
        return 'cool';
      case 3:
        return 'dry';
      case 4:
        return 'fan';
      case 5:
        return 'heat';
      default:
        throw new TypeError('Invalid MIoT air conditioner mode state.');
    }
  }

  @computed
  get targetTemperature(): Temperature | undefined {
    const {targetTemperature} = this.properties;

    if (targetTemperature === undefined) {
      return undefined;
    }

    const value = getOptionalNumberState(this.getState('targetTemperature'));

    if (value === undefined) {
      return Temperature.fromKelvin(0);
    }

    assertValueInRange(
      'air conditioner target temperature',
      value,
      getPropertyValueRange('air conditioner', targetTemperature),
    );
    return Temperature.fromCelsius(value);
  }

  @computed
  get targetRelativeHumidity(): number | undefined {
    const {targetRelativeHumidity} = this.properties;

    if (targetRelativeHumidity === undefined) {
      return undefined;
    }

    const value = getOptionalNumberState(
      this.getState('targetRelativeHumidity'),
    );

    if (value === undefined) {
      return 0;
    }

    assertValueInRange(
      'air conditioner target humidity',
      value,
      getPropertyValueRange('air conditioner', targetRelativeHumidity),
    );
    return value / 100;
  }

  @computed
  get temperature(): Temperature | undefined {
    const {temperature} = this.properties;

    if (temperature === undefined) {
      return undefined;
    }

    const value = getOptionalNumberState(this.getState('temperature'));

    if (value === undefined) {
      return Temperature.fromKelvin(0);
    }

    assertValueInRange(
      'air conditioner temperature',
      value,
      getPropertyValueRange('air conditioner', temperature),
    );
    return Temperature.fromCelsius(value);
  }

  @computed
  get relativeHumidity(): number | undefined {
    const {relativeHumidity} = this.properties;

    if (relativeHumidity === undefined) {
      return undefined;
    }

    const value = getOptionalNumberState(this.getState('relativeHumidity'));

    if (value === undefined) {
      return 0;
    }

    assertValueInRange(
      'air conditioner relative humidity',
      value,
      getPropertyValueRange('air conditioner', relativeHumidity),
    );
    return value / 100;
  }

  constructor(
    provider: MiotProvider,
    metadata: MiotEndpointConnectionResolvedMetadata,
    transports: MiotEndpointConnectionTransports,
  ) {
    super(provider, metadata, transports);
    this.properties =
      getMiotEndpointConnectionProperties<MiotAirConditionerEndpointProperties>(
        metadata,
      );
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

export const miotAirConditionerEndpointAdapter = defineMiotEndpointAdapter<
  AirConditionerEndpointCommand,
  AirConditionerEndpointConnection
>({
  type: 'air-conditioner',
  Endpoint: MiotAirConditionerEndpointConnection.Endpoint,
  Connection: MiotAirConditionerEndpointConnection,
  endpointProfiles: MiotAirConditionerEndpointConnection.endpointProfiles,
});

type MiotAirConditionerEndpointMatcher = Omit<
  MiotEndpointMatcher<
    {
      readonly on: MiotPropertyMatcher;
    },
    {
      readonly mode: MiotPropertyMatcher;
      readonly targetTemperature: MiotPropertyMatcher;
      readonly targetRelativeHumidity: MiotPropertyMatcher;
    }
  >,
  'device'
>;

type MiotAirConditionerEndpointProperties = {
  readonly on: MiotSpecProperty;
  readonly mode?: MiotSpecProperty;
  readonly targetTemperature?: MiotSpecProperty;
  readonly targetRelativeHumidity?: MiotSpecProperty;
  readonly temperature?: MiotSpecProperty;
  readonly relativeHumidity?: MiotSpecProperty;
};

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
      mode: getMiotAirConditionerMode(command.value),
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

function getMiotAirConditionerMode(mode: AirConditionerMode): number {
  switch (mode) {
    case 'cool':
      return 2;
    case 'dry':
      return 3;
    case 'fan':
      return 4;
    case 'heat':
      return 5;
    case 'auto':
      throw new CommandError(
        'MIoT air conditioner does not support auto mode.',
      );
  }
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
      mode:
        endpoint.mode === undefined
          ? undefined
          : getMiotAirConditionerMode(endpoint.mode),
      targetTemperature: endpoint.targetTemperature,
      targetRelativeHumidity: endpoint.targetRelativeHumidity,
    };
  }
}

function getOptionalNumberState(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Invalid MIoT air conditioner numeric state.');
  }

  return value;
}

function getPropertyValueRange(
  endpointType: string,
  property: MiotSpecProperty,
): MiotSpecValueRange {
  const valueRange = property['value-range'];

  if (!isValidMiotSpecValueRange(valueRange, property.format)) {
    throw new TypeError(`Invalid MIoT ${endpointType} property value range.`);
  }

  return valueRange;
}

function assertValueInRange(
  name: string,
  value: number,
  valueRange: MiotSpecValueRange,
): void {
  const [minimum, maximum] = valueRange;

  if (value < minimum || value > maximum) {
    throw new TypeError(`Invalid MIoT ${name} state.`);
  }
}
