import {CommandError} from '@homelib/core';

import {createMiotNamedValueCodecDefinition} from '../../../@endpoint-connection/property-value/named-value.js';
import type {MiotSpecProperty} from '../../../miot/index.js';

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

const MODE_CODEC_DEFINITION = createMiotNamedValueCodecDefinition<
  'cool' | 'dry' | 'heat'
>({
  'urn:miot-spec-v2:device:air-conditioner:0000A004:test-ac:*': {
    cool: 2,
    dry: 3,
    heat: 5,
  },
  '*': {cool: 5, heat: 2},
});

test('encodes and decodes a partial named domain with physical validation', () => {
  const codec = MODE_CODEC_DEFINITION.resolve({
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
  const exactCodec = MODE_CODEC_DEFINITION.resolve({
    deviceType: 'urn:miot-spec-v2:device:air-conditioner:0000A004:test-ac:2',
    property: MODE_PROPERTY,
  });
  const fallbackCodec = MODE_CODEC_DEFINITION.resolve({
    deviceType: 'urn:miot-spec-v2:device:air-conditioner:0000A004:other:1',
    property: MODE_PROPERTY,
  });

  expect(exactCodec?.encode('cool')).toBe(2);
  expect(fallbackCodec?.encode('cool')).toBe(5);
  expect(fallbackCodec?.decode(2)).toBe('heat');
});

test('fails closed when no mapping or no physical value is supported', () => {
  const exactOnlyCodecDefinition = createMiotNamedValueCodecDefinition<'cool'>({
    'urn:miot-spec-v2:device:air-conditioner:0000A004:test-ac:*': {cool: 2},
  });
  const unsupportedCodecDefinition = createMiotNamedValueCodecDefinition<'dry'>(
    {
      '*': {dry: 3},
    },
  );

  expect(
    exactOnlyCodecDefinition.resolve({
      deviceType: 'urn:miot-spec-v2:device:air-conditioner:0000A004:other:1',
      property: MODE_PROPERTY,
    }),
  ).toBeUndefined();
  expect(
    unsupportedCodecDefinition.resolve({
      deviceType: 'urn:miot-spec-v2:device:air-conditioner:0000A004:test-ac:1',
      property: MODE_PROPERTY,
    }),
  ).toBeUndefined();
});

test('supports named sentinels on ranged and format-only properties', () => {
  const sentinelCodecDefinition = createMiotNamedValueCodecDefinition<'auto'>({
    '*': {auto: 0},
  });
  const rangedCodec = sentinelCodecDefinition.resolve({
    deviceType: 'urn:miot-spec-v2:device:fan:0000A005:test:1',
    property: {
      ...FORMAT_ONLY_MODE_PROPERTY,
      'value-range': [0, 5, 1],
    },
  });
  const formatOnlyCodec = sentinelCodecDefinition.resolve({
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
  const codecDefinition = createMiotNamedValueCodecDefinition<'special'>({
    '*': {special: 0.3},
  });
  const codec = codecDefinition.resolve({
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
  expect(() => createMiotNamedValueCodecDefinition({})).toThrow(
    'A MIoT named value codec must contain a mapping.',
  );
  expect(() =>
    createMiotNamedValueCodecDefinition({'urn:test,': {cool: 2}}),
  ).toThrow('Invalid MIoT value codec URN pattern: urn:test,.');
  expect(() => createMiotNamedValueCodecDefinition({'*': {}})).toThrow(
    'A MIoT named value codec mapping must contain a value: *.',
  );
  expect(() => createMiotNamedValueCodecDefinition({'*': {'': 2}})).toThrow(
    'A MIoT named value codec key cannot be empty.',
  );
  expect(() =>
    createMiotNamedValueCodecDefinition({'*': {cool: Number.NaN}}),
  ).toThrow('Invalid MIoT named value codec raw value: cool=NaN.');
  expect(() =>
    createMiotNamedValueCodecDefinition({'*': {cool: 2, heat: 2}}),
  ).toThrow('Duplicate MIoT named value codec raw value: *=2.');
});
