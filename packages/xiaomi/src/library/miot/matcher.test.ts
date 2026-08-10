import {type MiotEndpointMatcher, findMiotEndpointMatches} from './matcher.js';
import type {MiotSpecInstance} from './spec.js';

const LIGHT_MATCHER = {
  device: 'urn:miot-spec-v2:device:light:0000A001',
  service: 'urn:miot-spec-v2:service:light:00007802',
  properties: {
    on: {
      type: 'urn:miot-spec-v2:property:on:00000006',
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
