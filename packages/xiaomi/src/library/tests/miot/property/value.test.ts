import type {MiotSpecProperty} from '../../../miot/index.js';
import {
  type MiotEncodedPropertyValue,
  canonicalizeMiotPropertyValue,
  encodeMiotPropertyValue,
} from '../../../miot/property/value.js';

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

test('canonicalizes only physical raw values without domain conversion', () => {
  const rangedProperty = {
    ...FORMAT_ONLY_MODE_PROPERTY,
    'value-range': [20, 100, 5],
  } satisfies MiotSpecProperty;

  expect(canonicalizeMiotPropertyValue(rangedProperty, 23)).toBe(25);
  expect(canonicalizeMiotPropertyValue(rangedProperty, 0.23)).toBe(20);
  expect(canonicalizeMiotPropertyValue(rangedProperty, -Infinity)).toBe(20);
  expect(canonicalizeMiotPropertyValue(rangedProperty, Infinity)).toBe(100);
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
