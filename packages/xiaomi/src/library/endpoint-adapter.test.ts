import {
  LightEndpoint,
  type LightEndpointCommand,
  type LightEndpointConnection,
} from '@homelib/core';

import {
  type MiotEndpointAdapter,
  MiotEndpointAdapterRegistry,
  type MiotEndpointProfile,
  defineMiotEndpointAdapter,
  getValidatedMiotEndpointProperties,
  getValidatedMiotEndpointResources,
} from './endpoint-adapter.js';
import {
  MiotEndpointConnection,
  MiotEndpointConnectionMetadata,
  getPrimaryMiotEndpointConnectionResource,
} from './endpoint-connection.js';
import type {MiotEndpointMatcher, MiotSpecInstance} from './miot/index.js';

const ON_MATCHER = {
  service: 'urn:miot-spec-v2:service:light:00007802',
  properties: {
    on: {
      type: 'urn:miot-spec-v2:property:on:00000006',
      format: 'bool',
      access: ['read', 'write', 'notify'],
    },
  },
} as const satisfies MiotEndpointMatcher;

const ALIAS_MATCHER = {
  ...ON_MATCHER,
  properties: {alias: ON_MATCHER.properties.on},
} as const satisfies MiotEndpointMatcher;

const ENRICHED_MATCHER = {
  ...ON_MATCHER,
  device: 'urn:miot-spec-v2:device:light:0000A001:test-light:1',
  properties: {
    ...ON_MATCHER.properties,
    mode: {
      type: 'urn:miot-spec-v2:property:mode:00000008',
      format: 'uint8',
      access: ['read', 'write', 'notify'],
      valueList: [0, 1],
    },
  },
} as const satisfies MiotEndpointMatcher;

const MODE_MATCHER = {
  service: 'urn:miot-spec-v2:service:fan:00007808',
  properties: {
    mode: {
      type: 'urn:miot-spec-v2:property:mode:00000008',
      format: 'uint8',
      access: ['read', 'write', 'notify'],
      valueList: [0, 1],
    },
  },
} as const satisfies MiotEndpointMatcher;

const ENVIRONMENT_MATCHER = {
  service: 'urn:miot-spec-v2:service:environment:0000780A',
  properties: {
    temperature: {
      type: 'urn:miot-spec-v2:property:temperature:00000020',
      format: 'float',
      access: ['read', 'notify'],
    },
  },
} as const satisfies MiotEndpointMatcher;

const TEST_PROFILES = [
  {
    primary: ENRICHED_MATCHER,
    supplements: [{matcher: ENVIRONMENT_MATCHER, required: true}],
  },
  {primary: ON_MATCHER},
] as const satisfies readonly MiotEndpointProfile[];

test('deduplicates identical matcher results with a stable candidate key', () => {
  const adapter = createTestAdapter('test', [ON_MATCHER, ON_MATCHER]);
  const candidates = adapter.findMetadataCandidates(TEST_DEVICE, TEST_SPEC);

  expect(candidates).toEqual([
    {
      key: JSON.stringify(['test', 'physical', 2, [['on', 1]]]),
      label: 'Light',
      metadata: expect.objectContaining({
        device: expect.objectContaining({did: 'physical'}),
        resources: [
          expect.objectContaining({
            service: expect.objectContaining({iid: 2}),
            properties: {on: expect.objectContaining({iid: 1})},
            exclusive: true,
          }),
        ],
      }),
    },
  ]);

  const metadata = candidates.at(0)?.metadata;

  if (metadata === undefined) {
    throw new Error('Test adapter returned no metadata candidate.');
  }

  expect(getPrimaryMiotEndpointConnectionResource(metadata)).toMatchObject({
    service: {iid: 2},
    properties: {on: {iid: 1}},
  });
});

test('discovers and self-validates a rich primary with a shared environment supplement', () => {
  const adapter = createTestProfileAdapter();
  const [candidate] = adapter.findMetadataCandidates(
    TEST_DEVICE,
    TEST_SPEC_WITH_MODE_AND_ENVIRONMENT,
  );

  expect(candidate).toMatchObject({
    key: JSON.stringify([
      'test-profile',
      'physical',
      2,
      [
        ['mode', 2],
        ['on', 1],
      ],
      [3, [['temperature', 1]]],
    ]),
    metadata: {
      resources: [
        {
          service: {iid: 2},
          properties: {on: {iid: 1}, mode: {iid: 2}},
          exclusive: true,
        },
        {
          service: {iid: 3},
          properties: {temperature: {iid: 1}},
          exclusive: false,
        },
      ],
    },
  });

  if (candidate === undefined) {
    throw new Error('Test profile adapter returned no metadata candidate.');
  }

  expect(() => adapter.assertMetadata(candidate.metadata)).not.toThrow();
});

test('does not fall back when an exact rich profile lacks a required supplement', () => {
  const adapter = createTestProfileAdapter();

  expect(
    adapter.findMetadataCandidates(TEST_DEVICE, TEST_SPEC_WITH_MODE),
  ).toEqual([]);
});

test('uses generic on-only metadata for an unknown device model', () => {
  const adapter = createTestProfileAdapter();
  const unknownSpec = {
    ...TEST_SPEC_WITH_MODE,
    type: 'urn:miot-spec-v2:device:light:0000A001:unknown-light:1',
  };

  expect(
    adapter.findMetadataCandidates(TEST_DEVICE, unknownSpec),
  ).toMatchObject([
    {
      key: JSON.stringify(['test-profile', 'physical', 2, [['on', 1]]]),
      metadata: {
        resources: [
          {
            service: {iid: 2},
            properties: {on: {iid: 1}},
            exclusive: true,
          },
        ],
      },
    },
  ]);
});

test('keeps the first matcher metadata for one physical service', () => {
  const adapter = createTestAdapter('test', [ALIAS_MATCHER, ON_MATCHER]);

  expect(adapter.findMetadataCandidates(TEST_DEVICE, TEST_SPEC)).toMatchObject([
    {metadata: {resources: [{properties: {alias: {iid: 1}}}]}},
  ]);
});

test('prefers an enriched matcher over a generic fallback', () => {
  const adapter = createTestAdapter('test', [ENRICHED_MATCHER, ON_MATCHER]);

  expect(
    adapter.findMetadataCandidates(TEST_DEVICE, TEST_SPEC_WITH_MODE),
  ).toMatchObject([
    {
      metadata: {
        resources: [{properties: {on: {iid: 1}, mode: {iid: 2}}}],
      },
    },
  ]);
});

test('uses a generic fallback when an enriched matcher does not match', () => {
  const adapter = createTestAdapter('test', [ENRICHED_MATCHER, ON_MATCHER]);

  expect(adapter.findMetadataCandidates(TEST_DEVICE, TEST_SPEC)).toMatchObject([
    {metadata: {resources: [{properties: {on: {iid: 1}}}]}},
  ]);
});

test('does not validate stale fallback metadata against a richer first profile', () => {
  const service = TEST_SPEC_WITH_MODE.services.at(0);
  const onProperty = service?.properties?.at(0);

  if (service === undefined || onProperty === undefined) {
    throw new Error('Test spec has no light service on property.');
  }

  const metadata = MiotEndpointConnectionMetadata.satisfies({
    device: {
      did: TEST_DEVICE.did,
      model: TEST_DEVICE.model,
      urn: TEST_SPEC_WITH_MODE.type,
    },
    resources: [{service, properties: {on: onProperty}, exclusive: true}],
  });

  expect(() =>
    getValidatedMiotEndpointProperties('test', metadata, [
      ENRICHED_MATCHER,
      ON_MATCHER,
    ]),
  ).toThrow('Invalid MIoT test endpoint metadata.');
});

test('rejects duplicate endpoint constructors in a registry', () => {
  const firstAdapter = createTestAdapter('first', [ON_MATCHER]);
  const secondAdapter = createTestAdapter('second', [ON_MATCHER]);

  expect(
    () => new MiotEndpointAdapterRegistry([firstAdapter, secondAdapter]),
  ).toThrow('Duplicate MIoT endpoint adapter Endpoint.');
});

test('rejects duplicate adapter types in a registry', () => {
  class SpecializedLightEndpoint extends LightEndpoint {}

  const firstAdapter = createTestAdapter('light', [ON_MATCHER]);
  const secondAdapter = createTestAdapter(
    'light',
    [ON_MATCHER],
    SpecializedLightEndpoint,
  );

  expect(
    () => new MiotEndpointAdapterRegistry([firstAdapter, secondAdapter]),
  ).toThrow('Duplicate MIoT endpoint adapter: light.');
});

test('looks up adapters by exact endpoint constructor', () => {
  class SpecializedLightEndpoint extends LightEndpoint {}

  const adapter = createTestAdapter('light', [ON_MATCHER]);
  const registry = new MiotEndpointAdapterRegistry([adapter]);

  expect(registry.get(new LightEndpoint())).toBe(adapter);
  expect(registry.get(new SpecializedLightEndpoint())).toBeUndefined();
});

test('validates value-list metadata independent of entry order', () => {
  const metadata = createModeMetadata([
    {value: 1, description: 'Natural Wind'},
    {value: 0, description: 'Straight Wind'},
  ]);

  expect(
    getValidatedMiotEndpointProperties('fan', metadata, [MODE_MATCHER]),
  ).toMatchObject({mode: {iid: 3}});
});

test('rejects value-list metadata with a changed description', () => {
  const metadata = createModeMetadata([
    {value: 0, description: 'Straight Wind'},
    {value: 1, description: 'Changed'},
  ]);

  expect(() =>
    getValidatedMiotEndpointProperties('fan', metadata, [MODE_MATCHER]),
  ).toThrow('Invalid MIoT fan endpoint metadata.');
});

test('rejects value-list metadata with duplicate raw values', () => {
  const metadata = createModeMetadata([
    {value: 0, description: 'Straight Wind'},
    {value: 0, description: 'Natural Wind'},
  ]);

  expect(() =>
    getValidatedMiotEndpointProperties('fan', metadata, [MODE_MATCHER]),
  ).toThrow('Invalid MIoT fan endpoint metadata.');
});

function createTestAdapter(
  type: string,
  endpointMatchers: readonly MiotEndpointMatcher[],
  Endpoint: new (
    name?: string,
  ) => LightEndpoint<LightEndpointConnection> = LightEndpoint,
): MiotEndpointAdapter {
  return defineMiotEndpointAdapter<
    LightEndpointCommand,
    LightEndpointConnection
  >({
    type,
    Endpoint,
    Connection: TestLightEndpointConnection,
    endpointMatchers,
  });
}

function createTestProfileAdapter(): MiotEndpointAdapter {
  return defineMiotEndpointAdapter<
    LightEndpointCommand,
    LightEndpointConnection
  >({
    type: 'test-profile',
    Endpoint: LightEndpoint,
    Connection: TestProfileLightEndpointConnection,
    endpointProfiles: TEST_PROFILES,
  });
}

class TestLightEndpointConnection
  extends MiotEndpointConnection<LightEndpointCommand>
  implements LightEndpointConnection
{
  get on(): boolean {
    return false;
  }

  get brightness(): number | undefined {
    return undefined;
  }

  get colorTemperature(): number | undefined {
    return undefined;
  }

  static assertMetadata(_metadata: MiotEndpointConnectionMetadata): void {}

  override processCommand(_command: LightEndpointCommand): Promise<void> {
    return Promise.resolve();
  }
}

class TestProfileLightEndpointConnection extends TestLightEndpointConnection {
  static override assertMetadata(
    metadata: MiotEndpointConnectionMetadata,
  ): void {
    getValidatedMiotEndpointResources('test-profile', metadata, TEST_PROFILES);
  }
}

const TEST_DEVICE = {did: 'physical', model: 'test.light'};

const TEST_SPEC: MiotSpecInstance = {
  type: 'urn:miot-spec-v2:device:light:0000A001:test-light:1',
  description: 'Test light',
  services: [
    {
      iid: 2,
      type: 'urn:miot-spec-v2:service:light:00007802:test-light:1',
      description: 'Light',
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:on:00000006:test-light:1',
          description: 'Switch Status',
          format: 'bool',
          access: ['read', 'write', 'notify'],
        },
      ],
    },
  ],
};

const TEST_SPEC_WITH_MODE: MiotSpecInstance = {
  ...TEST_SPEC,
  services: TEST_SPEC.services.map(service => ({
    ...service,
    properties: [
      ...(service.properties ?? []),
      {
        iid: 2,
        type: 'urn:miot-spec-v2:property:mode:00000008:test-light:1',
        description: 'Mode',
        format: 'uint8',
        access: ['read', 'write', 'notify'],
        'value-list': [
          {value: 0, description: 'Straight Wind'},
          {value: 1, description: 'Natural Wind'},
        ],
      },
    ],
  })),
};

const TEST_SPEC_WITH_MODE_AND_ENVIRONMENT: MiotSpecInstance = {
  ...TEST_SPEC_WITH_MODE,
  services: [
    ...TEST_SPEC_WITH_MODE.services,
    {
      iid: 3,
      type: 'urn:miot-spec-v2:service:environment:0000780A:test-light:1',
      description: 'Environment',
      properties: [
        {
          iid: 1,
          type: 'urn:miot-spec-v2:property:temperature:00000020:test-light:1',
          description: 'Temperature',
          format: 'float',
          access: ['read', 'notify'],
          unit: 'celsius',
          'value-range': [-30, 100, 0.1],
        },
      ],
    },
  ],
};

function createModeMetadata(
  metadataValueList: readonly {
    readonly value: number;
    readonly description: string;
  }[],
): MiotEndpointConnectionMetadata {
  const serviceProperty = {
    iid: 3,
    type: 'urn:miot-spec-v2:property:mode:00000008:test-fan:1',
    description: 'Mode',
    format: 'uint8',
    access: ['read', 'write', 'notify'],
    'value-list': [
      {value: 0, description: 'Straight Wind'},
      {value: 1, description: 'Natural Wind'},
    ],
  };

  return MiotEndpointConnectionMetadata.satisfies({
    device: {
      did: 'physical',
      model: 'test.fan',
      urn: 'urn:miot-spec-v2:device:fan:0000A005:test-fan:1',
    },
    resources: [
      {
        service: {
          iid: 2,
          type: 'urn:miot-spec-v2:service:fan:00007808:test-fan:1',
          description: 'Fan',
          properties: [serviceProperty],
        },
        properties: {
          mode: {...serviceProperty, 'value-list': [...metadataValueList]},
        },
        exclusive: true,
      },
    ],
  });
}
