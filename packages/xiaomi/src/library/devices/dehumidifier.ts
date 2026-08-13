import {
  CommandError,
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

import {clampAndQuantizeValue} from './value-range.js';

const MiotDehumidifierOn = x.boolean;

const MIOT_DEHUMIDIFIER_ENDPOINT_MATCHER: MiotDehumidifierEndpointMatcher = {
  service: 'urn:miot-spec-v2:service:dehumidifier:00007841',
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
      valueList: [0, 1, 2],
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

const MIOT_DEHUMIDIFIER_TEMPERATURE_MATCHER = {
  type: 'urn:miot-spec-v2:property:temperature:00000020',
  format: 'float',
  access: ['read', 'notify'],
  unit: 'celsius',
  valueRange: true,
} as const satisfies MiotPropertyMatcher;

const MIOT_DEHUMIDIFIER_RELATIVE_HUMIDITY_MATCHER = {
  type: 'urn:miot-spec-v2:property:relative-humidity:0000000C',
  format: 'uint8',
  access: ['read', 'notify'],
  unit: 'percentage',
  valueRange: true,
} as const satisfies MiotPropertyMatcher;

const MIOT_DEHUMIDIFIER_ENVIRONMENT_MATCHER = {
  service: 'urn:miot-spec-v2:service:environment:0000780A',
  properties: {
    temperature: MIOT_DEHUMIDIFIER_TEMPERATURE_MATCHER,
    relativeHumidity: MIOT_DEHUMIDIFIER_RELATIVE_HUMIDITY_MATCHER,
  },
};

const MIOT_DEHUMIDIFIER_TEMPERATURE_ENVIRONMENT_MATCHER = {
  service: 'urn:miot-spec-v2:service:environment:0000780A',
  properties: {temperature: MIOT_DEHUMIDIFIER_TEMPERATURE_MATCHER},
  optionalProperties: {
    relativeHumidity: MIOT_DEHUMIDIFIER_RELATIVE_HUMIDITY_MATCHER,
  },
};

const MIOT_DEHUMIDIFIER_RELATIVE_HUMIDITY_ENVIRONMENT_MATCHER = {
  service: 'urn:miot-spec-v2:service:environment:0000780A',
  properties: {
    relativeHumidity: MIOT_DEHUMIDIFIER_RELATIVE_HUMIDITY_MATCHER,
  },
  optionalProperties: {temperature: MIOT_DEHUMIDIFIER_TEMPERATURE_MATCHER},
};

const MIOT_DEHUMIDIFIER_ENDPOINT_PROFILES = [
  {
    services: [
      MIOT_DEHUMIDIFIER_ENDPOINT_MATCHER,
      MIOT_DEHUMIDIFIER_ENVIRONMENT_MATCHER,
    ],
  },
  {
    services: [
      MIOT_DEHUMIDIFIER_ENDPOINT_MATCHER,
      MIOT_DEHUMIDIFIER_TEMPERATURE_ENVIRONMENT_MATCHER,
      MIOT_DEHUMIDIFIER_RELATIVE_HUMIDITY_ENVIRONMENT_MATCHER,
    ],
  },
  {
    services: [
      MIOT_DEHUMIDIFIER_ENDPOINT_MATCHER,
      MIOT_DEHUMIDIFIER_TEMPERATURE_ENVIRONMENT_MATCHER,
    ],
  },
  {
    services: [
      MIOT_DEHUMIDIFIER_ENDPOINT_MATCHER,
      MIOT_DEHUMIDIFIER_RELATIVE_HUMIDITY_ENVIRONMENT_MATCHER,
    ],
  },
  {services: [MIOT_DEHUMIDIFIER_ENDPOINT_MATCHER]},
] as const satisfies readonly MiotEndpointProfile[];

export class MiotDehumidifierEndpointConnection
  extends MiotEndpointConnection<DehumidifierEndpointCommand>
  implements DehumidifierEndpointConnection
{
  static readonly Endpoint = DehumidifierEndpoint;

  static readonly endpointProfiles = MIOT_DEHUMIDIFIER_ENDPOINT_PROFILES;

  private readonly properties: MiotDehumidifierEndpointProperties;

  @computed
  get on(): boolean {
    const value = this.getState('on');

    return value === undefined ? false : MiotDehumidifierOn.satisfies(value);
  }

  @computed
  get mode(): DehumidifierMode | undefined {
    if (this.properties.mode === undefined) {
      return undefined;
    }

    const value = getOptionalNumberState(this.getState('mode'));

    if (value === undefined) {
      return 'auto';
    }

    switch (value) {
      case 0:
        return 'auto';
      case 1:
        return 'sleep';
      case 2:
        return 'laundry';
      default:
        throw new TypeError('Invalid MIoT dehumidifier mode state.');
    }
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
      'dehumidifier target humidity',
      value,
      getPropertyValueRange('dehumidifier', targetRelativeHumidity),
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
      'dehumidifier temperature',
      value,
      getPropertyValueRange('dehumidifier', temperature),
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
      'dehumidifier relative humidity',
      value,
      getPropertyValueRange('dehumidifier', relativeHumidity),
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
      getMiotEndpointConnectionProperties<MiotDehumidifierEndpointProperties>(
        metadata,
      );
  }

  override async processCommand(
    command: DehumidifierEndpointCommand,
  ): Promise<void> {
    await this.executeRequest(
      createMiotDehumidifierRequest(command, this.metadata, this.properties),
    );
  }
}

export const miotDehumidifierEndpointAdapter = defineMiotEndpointAdapter<
  DehumidifierEndpointCommand,
  DehumidifierEndpointConnection
>({
  type: 'dehumidifier',
  Endpoint: MiotDehumidifierEndpointConnection.Endpoint,
  Connection: MiotDehumidifierEndpointConnection,
  endpointProfiles: MiotDehumidifierEndpointConnection.endpointProfiles,
});

type MiotDehumidifierEndpointMatcher = Omit<
  MiotEndpointMatcher<
    {
      readonly on: MiotPropertyMatcher;
    },
    {
      readonly mode: MiotPropertyMatcher;
      readonly targetRelativeHumidity: MiotPropertyMatcher;
    }
  >,
  'device'
>;

type MiotDehumidifierEndpointProperties = {
  readonly on: MiotSpecProperty;
  readonly mode?: MiotSpecProperty;
  readonly targetRelativeHumidity?: MiotSpecProperty;
  readonly temperature?: MiotSpecProperty;
  readonly relativeHumidity?: MiotSpecProperty;
};

function createMiotDehumidifierRequest(
  command: DehumidifierEndpointCommand,
  metadata: MiotEndpointConnectionResolvedMetadata,
  properties: MiotDehumidifierEndpointProperties,
): MiotExecutionRequest {
  if (command instanceof SetDehumidifierOnCommand) {
    return createSetPropertyRequest(metadata, 'on', command.value);
  } else if (command instanceof SetDehumidifierModeCommand) {
    const property = properties.mode;

    if (property === undefined) {
      throw new CommandError('MIoT dehumidifier does not support mode.');
    }

    return createSetPropertyRequest(
      metadata,
      'mode',
      getMiotDehumidifierMode(command.value),
    );
  } else if (command instanceof SetDehumidifierTargetHumidityCommand) {
    const property = properties.targetRelativeHumidity;

    if (property === undefined) {
      throw new CommandError(
        'MIoT dehumidifier does not support target humidity.',
      );
    }

    const valueRange = getPropertyValueRange('dehumidifier', property);
    const rawValue = command.relativeHumidity * 100;

    return createSetPropertyRequest(
      metadata,
      'targetRelativeHumidity',
      clampAndQuantizeValue(rawValue, valueRange),
    );
  }

  throw new TypeError('Unsupported MIoT dehumidifier endpoint command.');
}

function getMiotDehumidifierMode(mode: DehumidifierMode): number {
  switch (mode) {
    case 'auto':
      return 0;
    case 'sleep':
      return 1;
    case 'laundry':
      return 2;
  }
}

function createSetPropertyRequest(
  metadata: MiotEndpointConnectionResolvedMetadata,
  propertyName: keyof MiotDehumidifierEndpointProperties,
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
    throw new TypeError('Invalid MIoT dehumidifier numeric state.');
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
