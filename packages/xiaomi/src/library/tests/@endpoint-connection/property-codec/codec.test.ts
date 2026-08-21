import type {MiotPropertyValueCodec} from '../../../@endpoint-connection/property-codec/codec.js';
import type {MiotSpecProperty} from '../../../miot/index.js';
import {encodeMiotPropertyValue} from '../../../miot/property/value.js';

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
