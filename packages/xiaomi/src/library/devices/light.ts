import {
  CommandError,
  LightEndpoint,
  type LightEndpointCommand,
  type LightEndpointConnection,
  SetLightBrightnessCommand,
  SetLightColorTemperatureCommand,
  SetLightOnCommand,
} from '@homelib/core';
import {computed} from 'mobx';
import * as x from 'x-value';

import {
  type MiotEndpointProfile,
  defineMiotEndpointAdapter,
  getValidatedMiotEndpointProperties,
} from '../endpoint-adapter.js';
import {
  MiotEndpointConnection,
  type MiotEndpointConnectionMetadata,
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

const MiotLightOn = x.boolean;

const MIOT_LIGHT_ENDPOINT_MATCHER: MiotLightEndpointMatcher = {
  service: 'urn:miot-spec-v2:service:light:00007802',
  properties: {
    on: {
      type: 'urn:miot-spec-v2:property:on:00000006',
      format: 'bool',
      access: ['read', 'write', 'notify'],
    },
  },
  optionalProperties: {
    brightness: {
      type: 'urn:miot-spec-v2:property:brightness:0000000D',
      format: ['uint8', 'uint16'],
      access: ['read', 'write', 'notify'],
      unit: 'percentage',
      valueRange: true,
    },
    colorTemperature: {
      type: 'urn:miot-spec-v2:property:color-temperature:0000000F',
      format: 'uint32',
      access: ['read', 'write', 'notify'],
      unit: 'kelvin',
      valueRange: true,
    },
  },
};

const MIOT_LIGHT_ENDPOINT_PROFILES = [
  {services: [MIOT_LIGHT_ENDPOINT_MATCHER]},
] as const satisfies readonly MiotEndpointProfile[];

export class MiotLightEndpointConnection
  extends MiotEndpointConnection<LightEndpointCommand>
  implements LightEndpointConnection
{
  static readonly Endpoint = LightEndpoint;

  static readonly endpointProfiles = MIOT_LIGHT_ENDPOINT_PROFILES;

  private readonly properties: MiotLightEndpointProperties;

  @computed
  get on(): boolean {
    const value = this.getState('on');

    return value === undefined ? false : MiotLightOn.satisfies(value);
  }

  @computed
  get brightness(): number | undefined {
    const {brightness} = this.properties;

    if (brightness === undefined) {
      return undefined;
    }

    const valueRange = getPropertyValueRange(brightness);
    const [, maximum] = valueRange;
    const value = getOptionalNumberState(this.getState('brightness'));

    if (value === undefined) {
      return 0;
    }

    assertValueInRange('brightness', value, valueRange);

    return value / maximum;
  }

  @computed
  get colorTemperature(): number | undefined {
    const {colorTemperature} = this.properties;

    if (colorTemperature === undefined) {
      return undefined;
    }

    const valueRange = getPropertyValueRange(colorTemperature);
    const [minimum] = valueRange;
    const value = getOptionalNumberState(this.getState('colorTemperature'));

    if (value === undefined) {
      return minimum;
    }

    assertValueInRange('color temperature', value, valueRange);

    return value;
  }

  constructor(
    provider: MiotProvider,
    metadata: MiotEndpointConnectionMetadata,
    transports: MiotEndpointConnectionTransports,
  ) {
    super(provider, metadata, transports);
    this.properties = getValidatedMiotEndpointProperties(
      'light',
      metadata,
      MIOT_LIGHT_ENDPOINT_PROFILES,
    );
  }

  static assertMetadata(metadata: MiotEndpointConnectionMetadata): void {
    getValidatedMiotEndpointProperties(
      'light',
      metadata,
      MIOT_LIGHT_ENDPOINT_PROFILES,
    );
  }

  override async processCommand(command: LightEndpointCommand): Promise<void> {
    await this.executeRequest(
      createMiotLightRequest(command, this.metadata, this.properties),
    );
  }
}

export const miotLightEndpointAdapter = defineMiotEndpointAdapter<
  LightEndpointCommand,
  LightEndpointConnection
>({
  type: 'light',
  Endpoint: MiotLightEndpointConnection.Endpoint,
  Connection: MiotLightEndpointConnection,
  endpointProfiles: MiotLightEndpointConnection.endpointProfiles,
});

type MiotLightEndpointMatcher = Omit<
  MiotEndpointMatcher<
    {
      readonly on: MiotPropertyMatcher;
    },
    {
      readonly brightness: MiotPropertyMatcher;
      readonly colorTemperature: MiotPropertyMatcher;
    }
  >,
  'device'
>;

type MiotLightEndpointProperties = {
  readonly on: MiotSpecProperty;
  readonly brightness?: MiotSpecProperty;
  readonly colorTemperature?: MiotSpecProperty;
};

function createMiotLightRequest(
  command: LightEndpointCommand,
  metadata: MiotEndpointConnectionMetadata,
  properties: MiotLightEndpointProperties,
): MiotExecutionRequest {
  if (command instanceof SetLightOnCommand) {
    return createSetPropertyRequest(metadata, 'on', command.value);
  } else if (command instanceof SetLightBrightnessCommand) {
    const property = properties.brightness;

    if (property === undefined) {
      throw new CommandError('MIoT light does not support brightness.');
    }

    const valueRange = getPropertyValueRange(property);
    const [, maximum] = valueRange;
    const rawValue = command.value * maximum;

    return createSetPropertyRequest(
      metadata,
      'brightness',
      quantizeValue(rawValue, valueRange),
    );
  } else if (command instanceof SetLightColorTemperatureCommand) {
    const property = properties.colorTemperature;

    if (property === undefined) {
      throw new CommandError('MIoT light does not support color temperature.');
    }

    const valueRange = getPropertyValueRange(property);
    const [minimum, maximum] = valueRange;

    if (command.value < minimum || command.value > maximum) {
      throw new CommandError(
        `MIoT light color temperature must be between ${minimum} and ${maximum}.`,
      );
    }

    return createSetPropertyRequest(
      metadata,
      'colorTemperature',
      quantizeValue(command.value, valueRange),
    );
  }

  throw new TypeError('Unsupported MIoT light endpoint command.');
}

function createSetPropertyRequest(
  metadata: MiotEndpointConnectionMetadata,
  propertyName: keyof MiotLightEndpointProperties,
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
    throw new TypeError('Invalid MIoT light numeric state.');
  }

  return value;
}

function getPropertyValueRange(property: MiotSpecProperty): MiotSpecValueRange {
  const valueRange = property['value-range'];

  if (!isValidMiotSpecValueRange(valueRange, property.format)) {
    throw new TypeError('Invalid MIoT light property value range.');
  }

  return valueRange;
}

function assertValueInRange(
  name: string,
  value: number,
  valueRange: MiotSpecValueRange,
): void {
  const [minimum, maximum] = valueRange;
  const quantizedValue = quantizeValue(value, valueRange);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 8;

  if (
    value < minimum ||
    value > maximum ||
    Math.abs(value - quantizedValue) > tolerance
  ) {
    throw new TypeError(`Invalid MIoT light ${name} state.`);
  }
}

function quantizeValue(
  value: number,
  [minimum, maximum, step]: MiotSpecValueRange,
): number {
  const quantized = minimum + Math.round((value - minimum) / step) * step;

  return Math.min(maximum, Math.max(minimum, quantized));
}
