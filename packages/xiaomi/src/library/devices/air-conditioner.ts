import {
  AirConditionerEndpoint,
  type AirConditionerEndpointCommand,
  type AirConditionerEndpointConnection,
  type AirConditionerMode,
  CommandError,
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
  getMiotEndpointConnectionProperty,
} from '../endpoint-connection.js';
import {
  type MiotEndpointMatcher,
  type MiotExecutionRequest,
  type MiotPropertyMatcher,
  MiotSetPropertyRequest,
  type MiotSpecProperty,
  type MiotSpecValueRange,
  isValidMiotSpecValueRange,
} from '../miot/index.js';
import type {MiotProvider} from '../provider.js';

import {clampAndQuantizeValue} from './@value-range.js';

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
      targetHumidity: {
        type: 'urn:miot-spec-v2:property:target-humidity:00000022',
        format: 'uint8',
        access: ['read', 'write', 'notify'],
        unit: 'percentage',
        valueRange: true,
      },
    },
  };

const MIOT_AIR_CONDITIONER_FALLBACK_ENDPOINT_MATCHER: MiotAirConditionerEndpointMatcher =
  {
    service: 'urn:miot-spec-v2:service:air-conditioner:0000780F',
    properties: {
      on: {
        type: 'urn:miot-spec-v2:property:on:00000006',
        format: 'bool',
        access: ['read', 'write', 'notify'],
      },
    },
  };

const MIOT_AIR_CONDITIONER_ENVIRONMENT_MATCHER: MiotEnvironmentEndpointMatcher =
  {
    service: 'urn:miot-spec-v2:service:environment:0000780A',
    properties: {
      temperature: {
        type: 'urn:miot-spec-v2:property:temperature:00000020',
        format: 'float',
        access: ['read', 'notify'],
        unit: 'celsius',
        valueRange: true,
      },
      humidity: {
        type: 'urn:miot-spec-v2:property:relative-humidity:0000000C',
        format: 'uint8',
        access: ['read', 'notify'],
        unit: 'percentage',
        valueRange: true,
      },
    },
  };

const MIOT_AIR_CONDITIONER_ENDPOINT_PROFILES = [
  {
    device: 'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-rr6r00:3',
    services: [
      MIOT_AIR_CONDITIONER_ENDPOINT_MATCHER,
      MIOT_AIR_CONDITIONER_ENVIRONMENT_MATCHER,
    ],
  },
  {services: [MIOT_AIR_CONDITIONER_FALLBACK_ENDPOINT_MATCHER]},
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
  get targetHumidity(): number | undefined {
    const {targetHumidity} = this.properties;

    if (targetHumidity === undefined) {
      return undefined;
    }

    const value = getOptionalNumberState(this.getState('targetHumidity'));

    if (value === undefined) {
      return 0;
    }

    assertValueInRange(
      'air conditioner target humidity',
      value,
      getPropertyValueRange('air conditioner', targetHumidity),
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
  get humidity(): number | undefined {
    const {humidity} = this.properties;

    if (humidity === undefined) {
      return undefined;
    }

    const value = getOptionalNumberState(this.getState('humidity'));

    if (value === undefined) {
      return 0;
    }

    assertValueInRange(
      'air conditioner humidity',
      value,
      getPropertyValueRange('air conditioner', humidity),
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

  override async processCommand(
    command: AirConditionerEndpointCommand,
  ): Promise<void> {
    await this.executeRequest(
      createMiotAirConditionerRequest(command, this.metadata, this.properties),
    );
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
      readonly targetHumidity: MiotPropertyMatcher;
    }
  >,
  'device'
>;

type MiotAirConditionerEndpointProperties = {
  readonly on: MiotSpecProperty;
  readonly mode?: MiotSpecProperty;
  readonly targetTemperature?: MiotSpecProperty;
  readonly targetHumidity?: MiotSpecProperty;
  readonly temperature?: MiotSpecProperty;
  readonly humidity?: MiotSpecProperty;
};

type MiotEnvironmentEndpointMatcher = Omit<
  MiotEndpointMatcher<{
    readonly temperature: MiotPropertyMatcher;
    readonly humidity: MiotPropertyMatcher;
  }>,
  'device'
>;

function createMiotAirConditionerRequest(
  command: AirConditionerEndpointCommand,
  metadata: MiotEndpointConnectionResolvedMetadata,
  properties: MiotAirConditionerEndpointProperties,
): MiotExecutionRequest {
  if (command instanceof SetAirConditionerOnCommand) {
    return createSetPropertyRequest(metadata, 'on', command.value);
  } else if (command instanceof SetAirConditionerModeCommand) {
    const property = properties.mode;

    if (property === undefined) {
      throw new CommandError('MIoT air conditioner does not support mode.');
    }

    const rawValue = getMiotAirConditionerMode(command.value);

    return createSetPropertyRequest(metadata, 'mode', rawValue);
  } else if (command instanceof SetAirConditionerTargetTemperatureCommand) {
    const property = properties.targetTemperature;

    if (property === undefined) {
      throw new CommandError(
        'MIoT air conditioner does not support target temperature.',
      );
    }

    const valueRange = getPropertyValueRange('air conditioner', property);
    const value = command.value.celsius;

    return createSetPropertyRequest(
      metadata,
      'targetTemperature',
      clampAndQuantizeValue(value, valueRange),
    );
  } else if (command instanceof SetAirConditionerTargetHumidityCommand) {
    const property = properties.targetHumidity;

    if (property === undefined) {
      throw new CommandError(
        'MIoT air conditioner does not support target humidity.',
      );
    }

    const valueRange = getPropertyValueRange('air conditioner', property);
    const rawValue = command.value * 100;

    return createSetPropertyRequest(
      metadata,
      'targetHumidity',
      clampAndQuantizeValue(rawValue, valueRange),
    );
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

function createSetPropertyRequest(
  metadata: MiotEndpointConnectionResolvedMetadata,
  propertyName: keyof MiotAirConditionerEndpointProperties,
  value: unknown,
): MiotSetPropertyRequest {
  const {service, property} = getMiotEndpointConnectionProperty(
    metadata,
    propertyName,
  );

  return new MiotSetPropertyRequest(
    {
      did: metadata.device.did,
      siid: service.iid,
      piid: property.iid,
    },
    value,
  );
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
