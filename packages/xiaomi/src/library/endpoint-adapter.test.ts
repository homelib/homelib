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
  miotEndpointConnectionMetadataEqual,
} from './endpoint-adapter.js';
import {
  MiotEndpointConnection,
  MiotEndpointConnectionMetadata,
  getMiotEndpointConnectionResourceKeys,
} from './endpoint-connection.js';
import type {
  MiotSpecInstance,
  MiotSpecProperty,
  MiotSpecService,
} from './miot/index.js';

const DEVICE_TYPE = 'urn:miot-spec-v2:device:light:0000A001:test-light:1';
const UNKNOWN_DEVICE_TYPE =
  'urn:miot-spec-v2:device:light:0000A001:unknown-light:1';
const LIGHT_SERVICE_TYPE = 'urn:miot-spec-v2:service:light:00007802';
const ENVIRONMENT_SERVICE_TYPE =
  'urn:miot-spec-v2:service:environment:0000780A';
const ON_PROPERTY_TYPE = 'urn:miot-spec-v2:property:on:00000006';
const MODE_PROPERTY_TYPE = 'urn:miot-spec-v2:property:mode:00000008';
const TEMPERATURE_PROPERTY_TYPE =
  'urn:miot-spec-v2:property:temperature:00000020';

const ON_MATCHER = {
  service: LIGHT_SERVICE_TYPE,
  properties: {
    on: {
      type: ON_PROPERTY_TYPE,
      format: 'bool',
      access: ['read', 'write', 'notify'],
    },
  },
} as const;

const RICH_LIGHT_MATCHER = {
  service: LIGHT_SERVICE_TYPE,
  properties: {
    ...ON_MATCHER.properties,
    mode: {
      type: MODE_PROPERTY_TYPE,
      format: 'uint8',
      access: ['read', 'write', 'notify'],
      valueList: [0, 1],
    },
  },
} as const;

const ENVIRONMENT_MATCHER = {
  service: ENVIRONMENT_SERVICE_TYPE,
  properties: {
    temperature: {
      type: TEMPERATURE_PROPERTY_TYPE,
      format: 'float',
      access: ['read', 'notify'],
      unit: 'celsius',
      valueRange: true,
    },
  },
} as const;

const TEST_PROFILES = [
  {
    device: DEVICE_TYPE,
    services: [RICH_LIGHT_MATCHER, ENVIRONMENT_MATCHER],
  },
  {services: [ON_MATCHER]},
] as const satisfies readonly MiotEndpointProfile[];

test('persists physical services and resolves aliases from current profiles', () => {
  const adapter = createProfileAdapter();
  const [candidate] = adapter.findMetadataCandidates(TEST_DEVICE, createSpec());

  expect(candidate).toMatchObject({
    key: JSON.stringify(['test-profile', 'physical', 2, 4]),
    label: 'Light 2 + Environment 4',
    metadata: {
      resources: [{service: {iid: 2}}, {service: {iid: 4}}],
    },
  });

  if (candidate === undefined) {
    throw new Error('Test profile adapter returned no metadata candidate.');
  }

  expect(
    candidate.metadata.resources.every(
      resource => !Object.hasOwn(resource, 'properties'),
    ),
  ).toBe(true);
  expect(adapter.resolveMetadata(candidate.metadata).resources).toMatchObject([
    {service: {iid: 2}, properties: {on: {iid: 1}, mode: {iid: 2}}},
    {service: {iid: 4}, properties: {temperature: {iid: 1}}},
  ]);
  expect(getMiotEndpointConnectionResourceKeys(candidate.metadata)).toEqual([
    JSON.stringify(['physical', 2]),
    JSON.stringify(['physical', 4]),
  ]);
});

test('validates the same combination regardless of resource order', () => {
  const adapter = createProfileAdapter();
  const metadata = requireCandidate(adapter, createSpec()).metadata;
  const reversed = MiotEndpointConnectionMetadata.satisfies({
    ...metadata,
    resources: [...metadata.resources].reverse(),
  });

  expect(() => adapter.resolveMetadata(reversed)).not.toThrow();
});

test('compares metadata collections by MIoT semantics instead of order', () => {
  const metadata = requireCandidate(
    createProfileAdapter(),
    createSpec(),
  ).metadata;
  const reordered = MiotEndpointConnectionMetadata.satisfies({
    ...metadata,
    resources: [...metadata.resources].reverse().map(resource => ({
      service: {
        ...resource.service,
        properties: resource.service.properties
          ?.map(reversePropertyCollections)
          .reverse(),
      },
    })),
  });

  expect(miotEndpointConnectionMetadataEqual(metadata, reordered)).toBe(true);
  expect(miotEndpointConnectionMetadataEqual(reordered, metadata)).toBe(true);
});

test.each(['did', 'model', 'urn'] as const)(
  'compares metadata device %s exactly',
  field => {
    const metadata = requireCandidate(
      createProfileAdapter(),
      createSpec(),
    ).metadata;
    const different = MiotEndpointConnectionMetadata.satisfies({
      ...metadata,
      device: {
        ...metadata.device,
        [field]: `${metadata.device[field]}-different`,
      },
    });

    expect(miotEndpointConnectionMetadataEqual(metadata, different)).toBe(
      false,
    );
  },
);

test('compares value-list descriptions and value-range tuple positions', () => {
  const metadata = requireCandidate(
    createProfileAdapter(),
    createSpec(),
  ).metadata;
  const differentValueList = mapMetadataProperties(metadata, property => {
    const valueList = property['value-list'];

    if (valueList === undefined) {
      return property;
    }

    return {
      ...property,
      'value-list': valueList.map((entry, index) => {
        return index === 0
          ? {...entry, description: `${entry.description} changed`}
          : entry;
      }),
    };
  });
  const differentValueRange = mapMetadataProperties(metadata, property => {
    const valueRange = property['value-range'];

    if (valueRange === undefined) {
      return property;
    }

    return {
      ...property,
      'value-range': [valueRange[1], valueRange[0], valueRange[2]],
    };
  });

  expect(
    miotEndpointConnectionMetadataEqual(metadata, differentValueList),
  ).toBe(false);
  expect(
    miotEndpointConnectionMetadataEqual(metadata, differentValueRange),
  ).toBe(false);
});

test('keeps known device profiles fail-closed when a service is missing', () => {
  const adapter = createProfileAdapter();
  const spec = createSpec();
  spec.services = spec.services.filter(service => service.iid !== 4);

  expect(adapter.findMetadataCandidates(TEST_DEVICE, spec)).toEqual([]);
});

test('uses generic fallback only when no device-specific profile applies', () => {
  const adapter = createProfileAdapter();
  const spec = createSpec(UNKNOWN_DEVICE_TYPE);
  spec.services = spec.services.filter(service => service.iid !== 4);
  const [candidate] = adapter.findMetadataCandidates(TEST_DEVICE, spec);

  expect(candidate?.metadata.resources).toMatchObject([{service: {iid: 2}}]);
});

test('higher-priority combinations suppress every overlapping fallback', () => {
  const profiles = [
    {services: [RICH_LIGHT_MATCHER, ENVIRONMENT_MATCHER]},
    {services: [ON_MATCHER]},
  ] as const satisfies readonly MiotEndpointProfile[];
  const adapter = createAdapter('priority', profiles);

  expect(
    adapter
      .findMetadataCandidates(TEST_DEVICE, createSpec())
      .map(({metadata}) => metadata.resources.map(({service}) => service.iid)),
  ).toEqual([[2, 4]]);
});

test('an incomplete higher-priority generic combination permits fallback', () => {
  const profiles = [
    {services: [RICH_LIGHT_MATCHER, ENVIRONMENT_MATCHER]},
    {services: [ON_MATCHER]},
  ] as const satisfies readonly MiotEndpointProfile[];
  const adapter = createAdapter('fallback', profiles);
  const spec = createSpec();
  spec.services = spec.services.filter(service => service.iid !== 4);

  expect(
    adapter
      .findMetadataCandidates(TEST_DEVICE, spec)
      .map(({metadata}) => metadata.resources.map(({service}) => service.iid)),
  ).toEqual([[2]]);
});

test('preserves overlapping combinations from the same profile as ambiguity', () => {
  const spec = createSpec();
  spec.services.push(createEnvironmentService(5));
  const adapter = createAdapter('ambiguous', [
    {services: [RICH_LIGHT_MATCHER, ENVIRONMENT_MATCHER]},
  ]);

  expect(
    adapter
      .findMetadataCandidates(TEST_DEVICE, spec)
      .map(({metadata}) => metadata.resources.map(({service}) => service.iid)),
  ).toEqual([
    [2, 4],
    [2, 5],
  ]);
});

test('rejects metadata whose resources are not fully reproduced by the resolver', () => {
  const adapter = createProfileAdapter();
  const metadata = requireCandidate(adapter, createSpec()).metadata;
  const [lightResource] = metadata.resources;

  if (lightResource === undefined) {
    throw new Error('Test metadata is incomplete.');
  }

  const staleMetadata = MiotEndpointConnectionMetadata.satisfies({
    ...metadata,
    resources: [lightResource],
  });

  expect(() => adapter.resolveMetadata(staleMetadata)).toThrow(
    'Invalid MIoT test-profile endpoint metadata.',
  );
});

test('derives a newly supported optional alias from persisted physical metadata', () => {
  const withoutOptional = createAdapter('optional', [{services: [ON_MATCHER]}]);
  const withOptional = createAdapter('optional', [
    {
      services: [
        {
          ...ON_MATCHER,
          optionalProperties: {mode: RICH_LIGHT_MATCHER.properties.mode},
        },
      ],
    },
  ]);
  const metadata = requireCandidate(withoutOptional, createSpec()).metadata;

  expect(metadata.resources[0]).not.toHaveProperty('properties');
  expect(
    withOptional.resolveMetadata(metadata).resources[0]?.properties,
  ).toMatchObject({on: {iid: 1}, mode: {iid: 2}});
});

test('fails closed when one physical resource set has different semantics', () => {
  const adapter = createAdapter('ambiguous-semantics', [
    {services: [ON_MATCHER]},
    {
      services: [
        {
          ...ON_MATCHER,
          properties: {power: ON_MATCHER.properties.on},
        },
      ],
    },
  ]);
  const metadata = MiotEndpointConnectionMetadata.satisfies({
    device: {...TEST_DEVICE, urn: DEVICE_TYPE},
    resources: [{service: createLightService(2)}],
  });

  expect(adapter.findMetadataCandidates(TEST_DEVICE, createSpec())).toEqual([]);
  expect(() => adapter.resolveMetadata(metadata)).toThrow(
    'Invalid MIoT ambiguous-semantics endpoint metadata.',
  );
});

test('deduplicates identical profile results with a stable candidate key', () => {
  const profiles = [
    {services: [ON_MATCHER]},
    {services: [ON_MATCHER]},
  ] as const satisfies readonly MiotEndpointProfile[];
  const adapter = createAdapter('test', profiles);

  expect(
    adapter.findMetadataCandidates(TEST_DEVICE, createSpec()),
  ).toHaveLength(1);
});

test('rejects duplicate endpoint constructors and adapter types', () => {
  class SpecializedLightEndpoint extends LightEndpoint {}

  const first = createAdapter('first', [{services: [ON_MATCHER]}]);
  const sameEndpoint = createAdapter('second', [{services: [ON_MATCHER]}]);
  const sameType = createAdapter(
    'first',
    [{services: [ON_MATCHER]}],
    SpecializedLightEndpoint,
  );

  expect(() => new MiotEndpointAdapterRegistry([first, sameEndpoint])).toThrow(
    'Duplicate MIoT endpoint adapter Endpoint.',
  );
  expect(() => new MiotEndpointAdapterRegistry([first, sameType])).toThrow(
    'Duplicate MIoT endpoint adapter: first.',
  );
});

function createProfileAdapter(): MiotEndpointAdapter {
  return createAdapter('test-profile', TEST_PROFILES);
}

function createAdapter(
  type: string,
  endpointProfiles: readonly MiotEndpointProfile[],
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
    endpointProfiles,
  });
}

function requireCandidate(
  adapter: MiotEndpointAdapter,
  spec: MiotSpecInstance,
): NonNullable<
  ReturnType<MiotEndpointAdapter['findMetadataCandidates']>[number]
> {
  const candidate = adapter.findMetadataCandidates(TEST_DEVICE, spec).at(0);

  if (candidate === undefined) {
    throw new Error('Test adapter returned no metadata candidate.');
  }

  return candidate;
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

  override processCommand(_command: LightEndpointCommand): Promise<void> {
    return Promise.resolve();
  }
}

const TEST_DEVICE = {did: 'physical', model: 'test.light'};

function createSpec(type = DEVICE_TYPE): MiotSpecInstance {
  return {
    type,
    description: 'Test light',
    services: [createLightService(2), createEnvironmentService(4)],
  };
}

function createLightService(iid: number): MiotSpecService {
  return {
    iid,
    type: `${LIGHT_SERVICE_TYPE}:test-light:1`,
    description: `Light ${iid}`,
    properties: [
      {
        iid: 1,
        type: `${ON_PROPERTY_TYPE}:test-light:1`,
        description: 'Switch Status',
        format: 'bool',
        access: ['read', 'write', 'notify'],
      },
      {
        iid: 2,
        type: `${MODE_PROPERTY_TYPE}:test-light:1`,
        description: 'Mode',
        format: 'uint8',
        access: ['read', 'write', 'notify'],
        'value-list': [
          {value: 0, description: 'Straight Wind'},
          {value: 1, description: 'Natural Wind'},
        ],
      },
    ],
  };
}

function createEnvironmentService(iid: number): MiotSpecService {
  return {
    iid,
    type: `${ENVIRONMENT_SERVICE_TYPE}:test-light:1`,
    description: `Environment ${iid}`,
    properties: [
      {
        iid: 1,
        type: `${TEMPERATURE_PROPERTY_TYPE}:test-light:1`,
        description: 'Temperature',
        format: 'float',
        access: ['read', 'notify'],
        unit: 'celsius',
        'value-range': [-30, 100, 0.1],
      },
    ],
  };
}

function reversePropertyCollections(
  property: MiotSpecProperty,
): MiotSpecProperty {
  return {
    ...property,
    access: [...property.access].reverse(),
    'value-list': property['value-list']?.toReversed(),
  };
}

function mapMetadataProperties(
  metadata: MiotEndpointConnectionMetadata,
  callback: (property: MiotSpecProperty) => MiotSpecProperty,
): MiotEndpointConnectionMetadata {
  return MiotEndpointConnectionMetadata.satisfies({
    ...metadata,
    resources: metadata.resources.map(resource => ({
      service: {
        ...resource.service,
        properties: resource.service.properties?.map(callback),
      },
    })),
  });
}
