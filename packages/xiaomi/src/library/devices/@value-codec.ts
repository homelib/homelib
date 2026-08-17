import {CommandError} from '@homelib/core';

import {
  type MiotResolvedSpecProperty,
  type MiotUrnPattern,
  isValidMiotUrnPattern,
  selectMiotUrnPatternValue,
} from '../miot/index.js';

import {
  type MiotEncodedPropertyValue,
  type MiotPropertyValue,
  canonicalizeMiotPropertyValue,
  encodeMiotPropertyValue,
} from './command-effect.js';

/** A device-specific value codec bound to one resolved physical property. */
export type MiotResolvedPropertyValueCodec<
  TDomain,
  TRaw extends MiotPropertyValue = MiotPropertyValue,
> = {
  /** Returns undefined when a physically valid raw value has no domain value. */
  readonly decode: (raw: unknown) => TDomain | undefined;

  /** Encodes one domain value into a canonical physical MIoT value. */
  readonly encode: (value: TDomain) => MiotEncodedPropertyValue<TRaw>;
};

/**
 * A device-owned codec definition that resolves against the complete device
 * URN and an already-resolved physical property.
 */
export type MiotPropertyValueCodec<
  TDomain,
  TRaw extends MiotPropertyValue = MiotPropertyValue,
> = {
  readonly resolve: (context: {
    readonly deviceType: string;
    readonly property: MiotResolvedSpecProperty;
  }) => MiotResolvedPropertyValueCodec<TDomain, TRaw> | undefined;
};

export type MiotNamedValueCodecMappings<TDomain extends string> = Readonly<
  Record<MiotUrnPattern, Readonly<Partial<Record<TDomain, number>>>>
>;

/**
 * Creates a numeric codec with device-URN-specific domain names.
 *
 * A selected branch may intentionally describe only part of the domain. A
 * raw mapping that the physical property's format, range, or value list does
 * not support is unavailable for that device, while an observed raw value
 * absent from the mapping decodes to undefined.
 */
export function createMiotNamedValueCodec<TDomain extends string>(
  mappings: MiotNamedValueCodecMappings<TDomain>,
): MiotPropertyValueCodec<TDomain, number> {
  const mappingEntries = Object.entries(mappings);

  if (mappingEntries.length === 0) {
    throw new TypeError('A MIoT named value codec must contain a mapping.');
  }

  const validatedMappings: Record<
    MiotUrnPattern,
    Readonly<Partial<Record<TDomain, number>>>
  > = {};

  for (const [pattern, mapping] of mappingEntries) {
    if (!isValidMiotUrnPattern(pattern)) {
      throw new TypeError(`Invalid MIoT value codec URN pattern: ${pattern}.`);
    }

    const valueEntries = Object.entries(mapping) as Array<[TDomain, number]>;

    if (valueEntries.length === 0) {
      throw new TypeError(
        `A MIoT named value codec mapping must contain a value: ${pattern}.`,
      );
    }

    const rawValueSet = new Set<number>();

    for (const [name, raw] of valueEntries) {
      if (name.trim().length === 0) {
        throw new TypeError('A MIoT named value codec key cannot be empty.');
      }

      if (!Number.isFinite(raw)) {
        throw new TypeError(
          `Invalid MIoT named value codec raw value: ${name}=${raw}.`,
        );
      }

      if (rawValueSet.has(raw)) {
        throw new TypeError(
          `Duplicate MIoT named value codec raw value: ${pattern}=${raw}.`,
        );
      }

      rawValueSet.add(raw);
    }

    validatedMappings[pattern] = Object.freeze({...mapping});
  }

  return {
    resolve({deviceType, property}) {
      const selectedMapping = selectMiotUrnPatternValue(
        deviceType,
        validatedMappings,
      );

      if (selectedMapping === undefined) {
        return undefined;
      }

      const supportedEntries = (
        Object.entries(selectedMapping) as Array<[TDomain, number]>
      ).filter(([, raw]) => {
        try {
          const canonicalRaw = canonicalizeMiotPropertyValue(property, raw);

          return (
            typeof canonicalRaw === 'number' &&
            areApproximatelyEqual(canonicalRaw, raw)
          );
        } catch {
          return false;
        }
      });

      if (supportedEntries.length === 0) {
        return undefined;
      }

      const domainToRaw = Object.fromEntries(supportedEntries) as Readonly<
        Partial<Record<TDomain, number>>
      >;

      return {
        decode(raw) {
          if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            return undefined;
          }

          try {
            const canonicalRaw = canonicalizeMiotPropertyValue(property, raw);

            if (
              typeof canonicalRaw !== 'number' ||
              !areApproximatelyEqual(canonicalRaw, raw)
            ) {
              return undefined;
            }
          } catch {
            return undefined;
          }

          return supportedEntries.find(([, mappedRaw]) =>
            areApproximatelyEqual(mappedRaw, raw),
          )?.[0];
        },
        encode(value) {
          if (typeof value !== 'string' || !Object.hasOwn(domainToRaw, value)) {
            throw new CommandError(
              `Unsupported MIoT named property value: ${String(value)}.`,
            );
          }

          const raw = domainToRaw[value as TDomain];

          if (raw === undefined) {
            throw new CommandError(
              `Unsupported MIoT named property value: ${value}.`,
            );
          }

          return encodeMiotPropertyValue(property, raw);
        },
      };
    },
  };
}

function areApproximatelyEqual(left: number, right: number): boolean {
  const tolerance =
    Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8;

  return Math.abs(left - right) <= tolerance;
}
