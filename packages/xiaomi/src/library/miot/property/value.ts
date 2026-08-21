import {
  type MiotResolvedSpecProperty,
  isValidMiotSpecValueList,
  isValidMiotSpecValueRange,
} from '../matcher.js';

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

/** A canonical primitive accepted by the MIoT property protocol. */
export type MiotPropertyValue = boolean | number | string;

declare const MIOT_ENCODED_PROPERTY_VALUE: unique symbol;

/** A physical MIoT value that has been canonicalized for a property. */
export type MiotEncodedPropertyValue<
  TValue extends MiotPropertyValue = MiotPropertyValue,
> = TValue & {
  readonly [MIOT_ENCODED_PROPERTY_VALUE]: true;
};

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

type WidenMiotPropertyValue<TValue extends MiotPropertyValue> =
  TValue extends boolean
    ? boolean
    : TValue extends number
      ? number
      : TValue extends string
        ? string
        : never;
