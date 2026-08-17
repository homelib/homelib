import {CommandError} from '@homelib/core';

import type {MiotSpecProperty} from '../miot/index.js';

import {
  type MiotPropertyValueCodec,
  createMiotNamedValueCodec,
} from './@value-codec.js';
import {
  type MiotEncodedPropertyValue,
  canonicalizeMiotPropertyValue,
  encodeMiotPropertyValue,
} from './command-effect.js';

const MODE_PROPERTY = {
  iid: 1,
  type: 'urn:miot-spec-v2:property:mode:00000008:test:1',
  description: 'Mode',
  format: 'uint8',
  access: ['read', 'write', 'notify'],
  'value-list': [
    {value: 0, description: 'Vendor Other'},
    {value: 2, description: 'Cool'},
    {value: 5, description: 'Heat'},
  ],
} as const satisfies MiotSpecProperty;

const FORMAT_ONLY_MODE_PROPERTY = {
  iid: 1,
  type: 'urn:miot-spec-v2:property:mode:00000008:test:1',
  description: 'Mode',
  format: 'uint8',
  access: ['read', 'write', 'notify'],
} as const satisfies MiotSpecProperty;

const MODE_CODEC = createMiotNamedValueCodec<'cool' | 'dry' | 'heat'>({
  'urn:miot-spec-v2:device:air-conditioner:0000A004:test-ac:*': {
    cool: 2,
    dry: 3,
    heat: 5,
  },
  '*': {cool: 5, heat: 2},
});

test('encodes and decodes a partial named domain with physical validation', () => {
  const codec = MODE_CODEC.resolve({
    deviceType: 'urn:miot-spec-v2:device:air-conditioner:0000A004:test-ac:1',
    property: MODE_PROPERTY,
  });

  expect(codec).toBeDefined();

  if (codec === undefined) {
    throw new TypeError('Expected a resolved test codec.');
  }

  const decoded: 'cool' | 'dry' | 'heat' | undefined = codec.decode(2);

  expect(decoded).toBe('cool');
  expect(codec.decode(5)).toBe('heat');
  expect(codec.decode(0)).toBeUndefined();
  expect(codec.decode(3)).toBeUndefined();
  expect(codec.decode('2')).toBeUndefined();
  expect(codec.decode(Number.NaN)).toBeUndefined();
  expect(codec.encode('cool')).toBe(2);
  expect(codec.encode('heat')).toBe(5);
  expect(() => codec.encode('dry')).toThrow(CommandError);
  expect(() => codec.encode('unknown' as 'cool')).toThrow(CommandError);

  // @ts-expect-error -- The codec accepts only its declared domain union.
  const invalidEncode: (value: 'auto') => number = codec.encode;

  void invalidEncode;
});

test('selects the most specific matching device URN branch', () => {
  const exactCodec = MODE_CODEC.resolve({
    deviceType: 'urn:miot-spec-v2:device:air-conditioner:0000A004:test-ac:2',
    property: MODE_PROPERTY,
  });
  const fallbackCodec = MODE_CODEC.resolve({
    deviceType: 'urn:miot-spec-v2:device:air-conditioner:0000A004:other:1',
    property: MODE_PROPERTY,
  });

  expect(exactCodec?.encode('cool')).toBe(2);
  expect(fallbackCodec?.encode('cool')).toBe(5);
  expect(fallbackCodec?.decode(2)).toBe('heat');
});

test('fails closed when no mapping or no physical value is supported', () => {
  const exactOnlyCodec = createMiotNamedValueCodec<'cool'>({
    'urn:miot-spec-v2:device:air-conditioner:0000A004:test-ac:*': {cool: 2},
  });
  const unsupportedCodec = createMiotNamedValueCodec<'dry'>({
    '*': {dry: 3},
  });

  expect(
    exactOnlyCodec.resolve({
      deviceType: 'urn:miot-spec-v2:device:air-conditioner:0000A004:other:1',
      property: MODE_PROPERTY,
    }),
  ).toBeUndefined();
  expect(
    unsupportedCodec.resolve({
      deviceType: 'urn:miot-spec-v2:device:air-conditioner:0000A004:test-ac:1',
      property: MODE_PROPERTY,
    }),
  ).toBeUndefined();
});

test('supports named sentinels on ranged and format-only properties', () => {
  const sentinelCodec = createMiotNamedValueCodec<'auto'>({
    '*': {auto: 0},
  });
  const rangedCodec = sentinelCodec.resolve({
    deviceType: 'urn:miot-spec-v2:device:fan:0000A005:test:1',
    property: {
      ...FORMAT_ONLY_MODE_PROPERTY,
      'value-range': [0, 5, 1],
    },
  });
  const formatOnlyCodec = sentinelCodec.resolve({
    deviceType: 'urn:miot-spec-v2:device:fan:0000A005:test:1',
    property: FORMAT_ONLY_MODE_PROPERTY,
  });

  expect(rangedCodec?.encode('auto')).toBe(0);
  expect(rangedCodec?.decode(0)).toBe('auto');
  expect(rangedCodec?.decode(1)).toBeUndefined();
  expect(formatOnlyCodec?.encode('auto')).toBe(0);
  expect(formatOnlyCodec?.decode(0)).toBe('auto');
});

test('accepts a decimal sentinel on a floating-point range step', () => {
  const codec = createMiotNamedValueCodec<'special'>({
    '*': {special: 0.3},
  }).resolve({
    deviceType: 'urn:miot-spec-v2:device:fan:0000A005:test:1',
    property: {
      ...FORMAT_ONLY_MODE_PROPERTY,
      format: 'float',
      'value-range': [0, 1, 0.1],
    },
  });

  expect(codec?.decode(0.3)).toBe('special');
  expect(codec?.decode(0.1 + 0.2)).toBe('special');
  expect(codec?.encode('special')).toBeCloseTo(0.3);
});

test('validates named mappings before resolving a device', () => {
  expect(() => createMiotNamedValueCodec({})).toThrow(
    'A MIoT named value codec must contain a mapping.',
  );
  expect(() => createMiotNamedValueCodec({'urn:test,': {cool: 2}})).toThrow(
    'Invalid MIoT value codec URN pattern: urn:test,.',
  );
  expect(() => createMiotNamedValueCodec({'*': {}})).toThrow(
    'A MIoT named value codec mapping must contain a value: *.',
  );
  expect(() => createMiotNamedValueCodec({'*': {'': 2}})).toThrow(
    'A MIoT named value codec key cannot be empty.',
  );
  expect(() => createMiotNamedValueCodec({'*': {cool: Number.NaN}})).toThrow(
    'Invalid MIoT named value codec raw value: cool=NaN.',
  );
  expect(() => createMiotNamedValueCodec({'*': {cool: 2, heat: 2}})).toThrow(
    'Duplicate MIoT named value codec raw value: *=2.',
  );
});

test('supports custom codecs whose domain combines a sentinel and numbers', () => {
  const codec = {
    resolve({property}) {
      return {
        decode(raw) {
          if (raw === 0) {
            return 'auto' as const;
          }

          return raw === 1 || raw === 2 ? raw - 1 : undefined;
        },
        encode(value) {
          return encodeMiotPropertyValue(
            property,
            value === 'auto' ? 0 : value + 1,
          );
        },
      };
    },
  } satisfies MiotPropertyValueCodec<'auto' | number, number>;
  const resolved = codec.resolve({
    deviceType: 'urn:miot-spec-v2:device:fan:0000A005:test:1',
    property: {
      ...MODE_PROPERTY,
      'value-list': [
        {value: 0, description: 'Auto'},
        {value: 1, description: 'Low'},
        {value: 2, description: 'High'},
      ],
    },
  });

  expect(resolved.decode(0)).toBe('auto');
  expect(resolved.decode(1)).toBe(0);
  expect(resolved.decode(2)).toBe(1);
  expect(resolved.decode(3)).toBeUndefined();
  expect(resolved.encode('auto')).toBe(0);
  expect(resolved.encode(0)).toBe(1);
  expect(resolved.encode(1)).toBe(2);
});

test('canonicalizes only physical raw values without domain conversion', () => {
  const rangedProperty = {
    ...FORMAT_ONLY_MODE_PROPERTY,
    'value-range': [20, 100, 5],
  } satisfies MiotSpecProperty;

  expect(canonicalizeMiotPropertyValue(rangedProperty, 23)).toBe(25);
  expect(canonicalizeMiotPropertyValue(rangedProperty, 0.23)).toBe(20);
  expect(() => canonicalizeMiotPropertyValue(MODE_PROPERTY, 3)).toThrow(
    'Invalid MIoT value-list property value.',
  );
  expect(() => canonicalizeMiotPropertyValue(MODE_PROPERTY, 'cool')).toThrow(
    'Invalid MIoT numeric property value.',
  );
});

test('marks only explicitly encoded physical values for effect use', () => {
  const encoded = encodeMiotPropertyValue(
    {
      ...FORMAT_ONLY_MODE_PROPERTY,
      'value-range': [20, 100, 5],
    },
    23,
  );
  const typed: MiotEncodedPropertyValue<number> = encoded;

  expect(encoded).toBe(25);

  // @ts-expect-error -- A primitive has not crossed the physical encoder.
  const unencoded: MiotEncodedPropertyValue<number> = 25;

  void typed;
  void unencoded;
});
