import {
  type CommandEffect,
  CommandError,
  type EndpointReference,
  Temperature,
} from '@homelib/core';

import {
  type MiotEndpointConnectionResolvedMetadata,
  getMiotEndpointConnectionProperty,
} from '../endpoint-connection.js';
import {
  type MiotResolvedSpecProperty,
  MiotSetPropertyRequest,
  isValidMiotSpecValueList,
  isValidMiotSpecValueRange,
  matchesMiotUrnPattern,
} from '../miot/index.js';

import {clampAndQuantizeValue} from './value-range.js';

const MIOT_BRIGHTNESS_PROPERTY_TYPE =
  'urn:miot-spec-v2:property:brightness:0000000D';
const MIOT_FAN_LEVEL_PROPERTY_TYPE =
  'urn:miot-spec-v2:property:fan-level:00000016';
const MIOT_RELATIVE_HUMIDITY_PROPERTY_TYPE =
  'urn:miot-spec-v2:property:relative-humidity:0000000C';
const MIOT_TARGET_HUMIDITY_PROPERTY_TYPE =
  'urn:miot-spec-v2:property:target-humidity:00000022';
const MIOT_NUMERIC_FORMAT_RANGES: Readonly<
  Record<string, readonly [minimum: number, maximum: number] | undefined>
> = {
  float: undefined,
  int8: [-128, 127],
  int16: [-32_768, 32_767],
  int32: [-2_147_483_648, 2_147_483_647],
  uint8: [0, 255],
  uint16: [0, 65_535],
  uint32: [0, 4_294_967_295],
};

export type MiotCommandEffectValues<TName extends string = string> = Readonly<
  Partial<Record<TName, unknown>>
>;

export type MiotCommandEffectConnection = {
  readonly metadata: MiotEndpointConnectionResolvedMetadata;
  getObservationRevision(names: Iterable<string>): number;
};

/**
 * A desired MIoT state expressed through aliases in resolved connection
 * metadata. Property addresses and numeric conventions come from the matched
 * MIoT spec rather than a second effect-specific schema.
 */
export abstract class MiotCommandEffect<
  TEndpoint extends EndpointReference,
  TPropertyName extends string,
> implements CommandEffect {
  private readonly properties: readonly MiotCommandEffectProperty[];

  private readonly connection: MiotCommandEffectConnection;

  private observationRevisions: readonly number[];

  private observationRevisionValue = 0;

  constructor(
    connection: MiotCommandEffectConnection,
    values: MiotCommandEffectValues<TPropertyName>,
  ) {
    const {metadata} = connection;
    const entries = Object.entries(values);

    if (entries.length === 0) {
      throw new TypeError('A MIoT command effect must contain a value.');
    }

    this.properties = entries
      .map(([name, value]) => {
        if (value === undefined) {
          throw new TypeError(
            `MIoT command effect value is undefined: ${name}.`,
          );
        }

        const {service, property} = getMiotEndpointConnectionProperty(
          metadata,
          name,
        );

        return {
          name,
          property,
          address: {
            did: metadata.device.did,
            siid: service.iid,
            piid: property.iid,
          },
          value: canonicalizeMiotEffectValue(property, value),
        };
      })
      .toSorted(compareMiotCommandEffectProperties);
    this.connection = connection;
    this.observationRevisions = this.getPropertyObservationRevisions();
  }

  get observationRevision(): number {
    const observationRevisions = this.getPropertyObservationRevisions();

    if (
      observationRevisions.every((revision, index) => {
        const previousRevision = this.observationRevisions[index];
        return previousRevision !== undefined && revision > previousRevision;
      })
    ) {
      this.observationRevisions = observationRevisions;
      this.observationRevisionValue++;
    }

    return this.observationRevisionValue;
  }

  /**
   * The request represented by a single-property effect.
   *
   * Multi-property effects are valid for equality and state matching, but
   * their external execution must be defined explicitly instead of being
   * silently expanded into non-atomic sequential writes.
   */
  get request(): MiotSetPropertyRequest {
    const [property] = this.properties;

    if (property === undefined || this.properties.length !== 1) {
      throw new TypeError(
        'A multi-property MIoT effect does not define one property request.',
      );
    }

    if (!property.property.access.includes('write')) {
      throw new CommandError(
        `MIoT command effect property is not writable: ${property.name}.`,
      );
    }

    return new MiotSetPropertyRequest(property.address, property.value);
  }

  /** Describes the canonical values that this effect writes to the device. */
  toLogString(): string {
    return this.properties
      .map(({name, value}) => `set ${name}=${value}`)
      .join(' ');
  }

  equals(effect: CommandEffect): boolean {
    if (!(effect instanceof MiotCommandEffect)) {
      return false;
    }

    return miotCommandEffectPropertiesEqual(this.properties, effect.properties);
  }

  matches(endpoint: EndpointReference): boolean {
    const values = this.getValues(endpoint as TEndpoint);

    for (const target of this.properties) {
      const value = values[target.name as TPropertyName];

      if (
        value === undefined ||
        canonicalizeMiotEffectValue(target.property, value) !== target.value
      ) {
        return false;
      }
    }

    return true;
  }

  /** Returns current domain values indexed by the same resolved aliases. */
  protected abstract getValues(
    endpoint: TEndpoint,
  ): MiotCommandEffectValues<TPropertyName>;

  private getPropertyObservationRevisions(): readonly number[] {
    return this.properties.map(property =>
      this.connection.getObservationRevision([property.name]),
    );
  }
}

type MiotCommandEffectProperty = {
  readonly name: string;
  readonly property: MiotResolvedSpecProperty;
  readonly address: {
    readonly did: string;
    readonly siid: number;
    readonly piid: number;
  };
  readonly value: boolean | number | string;
};

function canonicalizeMiotEffectValue(
  property: MiotResolvedSpecProperty,
  value: unknown,
): boolean | number | string {
  const miotValue = getMiotEffectValue(property, value);
  const {format} = property;

  if (format === 'bool') {
    if (typeof miotValue !== 'boolean') {
      throw new TypeError('Invalid MIoT boolean command effect value.');
    }

    return miotValue;
  }

  if (format === 'string') {
    if (typeof miotValue !== 'string') {
      throw new TypeError('Invalid MIoT string command effect value.');
    }

    return miotValue;
  }

  if (typeof miotValue !== 'number' || !Number.isFinite(miotValue)) {
    throw new TypeError('Invalid MIoT numeric command effect value.');
  }

  if (!Object.hasOwn(MIOT_NUMERIC_FORMAT_RANGES, format)) {
    throw new TypeError(`Unsupported MIoT command effect format: ${format}.`);
  }

  const valueList = property['value-list'];

  if (valueList !== undefined) {
    if (
      !isValidMiotSpecValueList(valueList) ||
      !valueList.some(entry => entry.value === miotValue)
    ) {
      throw new TypeError('Invalid MIoT value-list command effect value.');
    }
  }

  const valueRange = property['value-range'];
  const canonicalValue =
    valueRange === undefined
      ? miotValue
      : isValidMiotSpecValueRange(valueRange, format)
        ? clampAndQuantizeValue(miotValue, valueRange)
        : undefined;

  if (canonicalValue === undefined) {
    throw new TypeError('Invalid MIoT command effect value range.');
  }

  if (
    /^(?:u?int(?:8|16|32))$/.test(format) &&
    !Number.isInteger(canonicalValue)
  ) {
    throw new TypeError('Invalid MIoT integer command effect value.');
  }

  const formatRange = MIOT_NUMERIC_FORMAT_RANGES[format];

  if (
    formatRange !== undefined &&
    (canonicalValue < formatRange[0] || canonicalValue > formatRange[1])
  ) {
    throw new TypeError('MIoT command effect value exceeds its format range.');
  }

  return canonicalValue;
}

function getMiotEffectValue(
  property: MiotResolvedSpecProperty,
  value: unknown,
): unknown {
  if (property.enum !== undefined) {
    if (typeof value !== 'string') {
      throw new TypeError('Invalid MIoT enum command effect value.');
    }

    if (!Object.hasOwn(property.enum, value)) {
      throw new CommandError(`Unsupported MIoT enum value: ${value}.`);
    }

    const enumValue = property.enum[value];

    return enumValue;
  }

  if (value instanceof Temperature) {
    switch (property.unit) {
      case 'celsius':
        return value.celsius;
      case 'fahrenheit':
        return value.fahrenheit;
      case 'kelvin':
        return value.kelvin;
      default:
        throw new TypeError(
          `Unsupported MIoT temperature unit: ${property.unit ?? 'none'}.`,
        );
    }
  }

  if (typeof value !== 'number') {
    return value;
  }

  if (matchesMiotUrnPattern(property.type, MIOT_BRIGHTNESS_PROPERTY_TYPE)) {
    const valueRange = property['value-range'];

    if (!isValidMiotSpecValueRange(valueRange, property.format)) {
      throw new TypeError('Invalid MIoT brightness value range.');
    }

    return value * valueRange[1];
  }

  if (
    matchesMiotUrnPattern(
      property.type,
      MIOT_RELATIVE_HUMIDITY_PROPERTY_TYPE,
    ) ||
    matchesMiotUrnPattern(property.type, MIOT_TARGET_HUMIDITY_PROPERTY_TYPE)
  ) {
    return value * 100;
  }

  if (matchesMiotUrnPattern(property.type, MIOT_FAN_LEVEL_PROPERTY_TYPE)) {
    const valueList = property['value-list'];

    if (!isValidMiotSpecValueList(valueList)) {
      throw new TypeError('Invalid MIoT fan-level value list.');
    }

    const levels = valueList
      .map(entry => entry.value)
      .toSorted((a, b) => a - b);
    const index = Math.min(
      levels.length - 1,
      Math.max(0, Math.round(value * levels.length) - 1),
    );

    return levels[index];
  }

  return value;
}

function compareMiotCommandEffectProperties(
  left: MiotCommandEffectProperty,
  right: MiotCommandEffectProperty,
): number {
  return (
    left.address.did.localeCompare(right.address.did) ||
    left.address.siid - right.address.siid ||
    left.address.piid - right.address.piid
  );
}

function miotCommandEffectPropertiesEqual(
  left: readonly MiotCommandEffectProperty[],
  right: readonly MiotCommandEffectProperty[],
): boolean {
  return (
    left.length === right.length &&
    left.every((property, index) => {
      const other = right[index];

      return (
        other !== undefined &&
        property.name === other.name &&
        property.address.did === other.address.did &&
        property.address.siid === other.address.siid &&
        property.address.piid === other.address.piid &&
        property.value === other.value
      );
    })
  );
}
