import {
  type CommandEffect,
  CommandError,
  type EndpointReference,
} from '@homelib/core';

import {
  type MiotEncodedPropertyValue,
  type MiotEndpointConnectionResolvedMetadata,
  type MiotPropertyValue,
  getMiotEndpointConnectionProperty,
} from '../endpoint-connection.js';
import {
  type MiotResolvedSpecProperty,
  MiotSetPropertyRequest,
  isValidMiotSpecValueList,
  isValidMiotSpecValueRange,
} from '../miot/index.js';

import {clampAndQuantizeValue} from './value-range.js';

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

export type {
  MiotEncodedPropertyValue,
  MiotPropertyValue,
} from '../endpoint-connection.js';

/** Canonicalizes and marks one value as encoded for a physical property. */
export function encodeMiotPropertyValue<TValue extends MiotPropertyValue>(
  property: MiotResolvedSpecProperty,
  value: TValue,
): MiotEncodedPropertyValue<WidenMiotPropertyValue<TValue>> {
  return canonicalizeMiotPropertyValue(
    property,
    value,
  ) as MiotEncodedPropertyValue<WidenMiotPropertyValue<TValue>>;
}

/**
 * Validates and canonicalizes one raw MIoT property value.
 *
 * Numeric ranges retain the existing command behavior: values are clamped and
 * quantized to the declared control step. No domain-level unit conversion is
 * performed here.
 */
export function canonicalizeMiotPropertyValue(
  property: MiotResolvedSpecProperty,
  value: unknown,
): MiotPropertyValue {
  const {format} = property;

  if (format === 'bool') {
    if (typeof value !== 'boolean') {
      throw new TypeError('Invalid MIoT boolean property value.');
    }

    return value;
  }

  if (format === 'string') {
    if (typeof value !== 'string') {
      throw new TypeError('Invalid MIoT string property value.');
    }

    return value;
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new TypeError('Invalid MIoT numeric property value.');
  }

  if (!Object.hasOwn(MIOT_NUMERIC_FORMAT_RANGES, format)) {
    throw new TypeError(`Unsupported MIoT property format: ${format}.`);
  }

  const valueList = property['value-list'];

  if (valueList !== undefined) {
    if (
      !isValidMiotSpecValueList(valueList) ||
      !valueList.some(entry => entry.value === value)
    ) {
      throw new TypeError('Invalid MIoT value-list property value.');
    }
  }

  const valueRange = property['value-range'];
  const canonicalValue =
    valueRange === undefined
      ? value
      : isValidMiotSpecValueRange(valueRange, format)
        ? clampAndQuantizeValue(value, valueRange)
        : undefined;

  if (canonicalValue === undefined) {
    throw new TypeError('Invalid MIoT property value range.');
  }

  if (!Number.isFinite(canonicalValue)) {
    throw new TypeError('Invalid MIoT numeric property value.');
  }

  if (
    /^(?:u?int(?:8|16|32))$/.test(format) &&
    !Number.isInteger(canonicalValue)
  ) {
    throw new TypeError('Invalid MIoT integer property value.');
  }

  const formatRange = MIOT_NUMERIC_FORMAT_RANGES[format];

  if (
    formatRange !== undefined &&
    (canonicalValue < formatRange[0] || canonicalValue > formatRange[1])
  ) {
    throw new TypeError('MIoT property value exceeds its format range.');
  }

  return canonicalValue;
}

export type MiotCommandEffectValues<TName extends string = string> = Readonly<
  Partial<Record<TName, MiotEncodedPropertyValue>>
>;

export type MiotCommandEffectLabels<TName extends string = string> = Readonly<
  Partial<Record<TName, string>>
>;

export type MiotCommandEffectConnection = {
  readonly metadata: MiotEndpointConnectionResolvedMetadata;
  getCommandEffectState(name: string): unknown;
  getObservationRevision(names: Iterable<string>): number;
};

/**
 * A desired MIoT state expressed through aliases in resolved connection
 * metadata. Property addresses and numeric conventions come from the matched
 * MIoT spec rather than a second effect-specific schema.
 */
export class MiotCommandEffect<
  TPropertyName extends string,
> implements CommandEffect {
  private readonly properties: readonly MiotCommandEffectProperty[];

  private readonly connection: MiotCommandEffectConnection;

  private observationRevisions: readonly number[];

  private observationRevisionValue = 0;

  constructor(
    connection: MiotCommandEffectConnection,
    values: MiotCommandEffectValues<TPropertyName>,
    labels?: MiotCommandEffectLabels<TPropertyName>,
  ) {
    const {metadata} = connection;
    const entries = Object.entries(values) as Array<
      [TPropertyName, MiotEncodedPropertyValue | undefined]
    >;

    if (entries.length === 0) {
      throw new TypeError('A MIoT command effect must contain a value.');
    }

    const labelEntries = Object.entries(labels ?? {}) as Array<
      [TPropertyName, string | undefined]
    >;

    for (const [name, label] of labelEntries) {
      if (label === undefined) {
        continue;
      }

      if (!Object.hasOwn(values, name)) {
        throw new TypeError(
          `MIoT command effect label has no corresponding value: ${name}.`,
        );
      }

      if (label.trim().length === 0) {
        throw new TypeError(`MIoT command effect label is empty: ${name}.`);
      }
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
          label: labels?.[name],
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
      .map(({name, value, label}) => {
        return `set ${name}=${value}${label === undefined ? '' : ` (${label})`}`;
      })
      .join(' ');
  }

  equals(effect: CommandEffect): boolean {
    if (!(effect instanceof MiotCommandEffect)) {
      return false;
    }

    return miotCommandEffectPropertiesEqual(this.properties, effect.properties);
  }

  matches(_endpoint: EndpointReference): boolean {
    for (const target of this.properties) {
      const value = this.connection.getCommandEffectState(target.name);

      if (
        value === undefined ||
        canonicalizeMiotPropertyValue(target.property, value) !== target.value
      ) {
        return false;
      }
    }

    return true;
  }
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
  readonly label: string | undefined;
};

function canonicalizeMiotEffectValue(
  property: MiotResolvedSpecProperty,
  value: MiotEncodedPropertyValue,
): MiotPropertyValue {
  const valueList = property['value-list'];

  if (valueList !== undefined) {
    if (!isValidMiotSpecValueList(valueList)) {
      throw new TypeError('Invalid MIoT command effect value list.');
    }

    if (
      typeof value !== 'number' ||
      !valueList.some(entry => entry.value === value)
    ) {
      throw new CommandError(`Unsupported MIoT property value: ${value}.`);
    }
  }

  return encodeMiotPropertyValue(property, value);
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

type WidenMiotPropertyValue<TValue extends MiotPropertyValue> =
  TValue extends boolean
    ? boolean
    : TValue extends number
      ? number
      : TValue extends string
        ? string
        : never;
