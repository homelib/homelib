import {type MiotEndpointMatcher, findMiotEndpointMatches} from './matcher.js';
import type {MiotSpecInstance} from './spec.js';

const LIGHT_MATCHER = {
  device: 'urn:miot-spec-v2:device:light:0000A001',
  service: 'urn:miot-spec-v2:service:light:00007802',
  properties: {
    on: {
      type: 'urn:miot-spec-v2:property:on:00000006',
      format: 'bool',
      access: ['read', 'write'],
    },
  },
} as const satisfies MiotEndpointMatcher;

const DIMMABLE_LIGHT_MATCHER = {
  ...LIGHT_MATCHER,
  optionalProperties: {
    brightness: {
      type: 'urn:miot-spec-v2:property:brightness:0000000D',
      format: 'uint8',
      access: ['read', 'write'],
    },
  },
} as const satisfies MiotEndpointMatcher;

test('matches the light service and property from the light group spec', () => {
  const matches = findMiotEndpointMatches(LIGHT_GROUP_SPEC, LIGHT_MATCHER);

  expect(matches).toHaveLength(1);
  expect(matches[0]?.service.iid).toBe(2);
  expect(matches[0]?.properties.on.iid).toBe(1);
});

test('matches any declared device type', () => {
  const matcher = {
    ...LIGHT_MATCHER,
    device: [
      'urn:miot-spec-v2:device:air-conditioner:0000A004',
      'urn:miot-spec-v2:device:light:0000A001',
    ],
  } as const satisfies MiotEndpointMatcher;

  expect(findMiotEndpointMatches(LIGHT_GROUP_SPEC, matcher)).toHaveLength(1);
});

test('requires the declared property format', () => {
  const service = LIGHT_GROUP_SPEC.services.at(0);
  const property = service?.properties?.at(0);

  if (service === undefined || property === undefined) {
    throw new Error('Light group spec has no light property.');
  }

  const spec: MiotSpecInstance = {
    ...LIGHT_GROUP_SPEC,
    services: [
      {
        ...service,
        properties: [{...property, format: 'uint8'}],
      },
    ],
  };

  expect(findMiotEndpointMatches(spec, LIGHT_MATCHER)).toHaveLength(0);
});

test('includes a matching optional property', () => {
  const service = LIGHT_GROUP_SPEC.services.at(0);

  if (service === undefined) {
    throw new Error('Light group spec has no light service.');
  }

  const spec: MiotSpecInstance = {
    ...LIGHT_GROUP_SPEC,
    services: [
      {
        ...service,
        properties: [
          ...(service.properties ?? []),
          {
            iid: 2,
            type: 'urn:miot-spec-v2:property:brightness:0000000D:test:1',
            description: 'Brightness',
            format: 'uint8',
            access: ['read', 'write', 'notify'],
          },
        ],
      },
    ],
  };
  const [match] = findMiotEndpointMatches(spec, DIMMABLE_LIGHT_MATCHER);

  expect(match?.properties.brightness?.iid).toBe(2);
});

test('does not reject a service without an optional property', () => {
  const [match] = findMiotEndpointMatches(
    LIGHT_GROUP_SPEC,
    DIMMABLE_LIGHT_MATCHER,
  );

  expect(match?.service.iid).toBe(2);
  expect(match?.properties.brightness).toBeUndefined();
  expect(Object.hasOwn(match?.properties ?? {}, 'brightness')).toBe(false);
});

test('omits an ambiguous optional property', () => {
  const service = LIGHT_GROUP_SPEC.services.at(0);

  if (service === undefined) {
    throw new Error('Light group spec has no light service.');
  }

  const brightnessProperties = [2, 3].map(iid => ({
    iid,
    type: `urn:miot-spec-v2:property:brightness:0000000D:test:${iid}`,
    description: 'Brightness',
    format: 'uint8',
    access: ['read', 'write'],
  }));
  const spec: MiotSpecInstance = {
    ...LIGHT_GROUP_SPEC,
    services: [
      {
        ...service,
        properties: [...(service.properties ?? []), ...brightnessProperties],
      },
    ],
  };
  const [match] = findMiotEndpointMatches(spec, DIMMABLE_LIGHT_MATCHER);

  expect(match?.service.iid).toBe(2);
  expect(match?.properties.brightness).toBeUndefined();
});

test('does not map one property to multiple aliases', () => {
  const matcher = {
    ...LIGHT_MATCHER,
    optionalProperties: {
      duplicateOn: LIGHT_MATCHER.properties.on,
    },
  } as const satisfies MiotEndpointMatcher;
  const [match] = findMiotEndpointMatches(LIGHT_GROUP_SPEC, matcher);

  expect(match?.service.iid).toBe(2);
  expect(match?.properties.duplicateOn).toBeUndefined();
});

test('returns every matching service instance', () => {
  const duplicateServiceSpec: MiotSpecInstance = {
    ...LIGHT_GROUP_SPEC,
    services: [
      ...LIGHT_GROUP_SPEC.services,
      {...LIGHT_GROUP_SPEC.services[0]!, iid: 3},
    ],
  };

  expect(
    findMiotEndpointMatches(duplicateServiceSpec, LIGHT_MATCHER).map(
      match => match.service.iid,
    ),
  ).toEqual([2, 3]);
});

const LIGHT_GROUP_SPEC: MiotSpecInstance = {
  type: 'urn:miot-spec-v2:device:light:0000A001:mijia-group3:3:0000C802',
  description: 'Lightctl Light',
  services: [
    {
      iid: 2,
      type: 'urn:miot-spec-v2:service:light:00007802:mijia-group3:1:0000C802',
      description: 'Light',
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:on:00000006:mijia-group3:1:0000C802',
          description: 'Switch Status',
          format: 'bool',
          access: ['read', 'write', 'notify'],
        },
      ],
    },
  ],
};
