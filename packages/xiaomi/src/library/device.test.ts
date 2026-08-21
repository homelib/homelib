import {
  type CommandExecution,
  Device,
  LightEndpoint,
  type LightEndpointCommand,
  type LightEndpointConnection,
} from '@homelib/core';

import {
  MiotDeviceRegistry,
  type MiotEndpointConnectionConstructor,
  createMiotDeviceEndpointConnectionBinding,
  createMiotEndpointConnectionMetadata,
  miotEndpointConnectionMetadataEqual,
  resolveMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionResources,
} from './device.js';
import {
  LegacyMiotEndpointConnectionMetadata,
  MiotEndpointConnection,
  MiotEndpointConnectionMetadata,
  type MiotEndpointConnectionResolvedResource,
  getMiotEndpointConnectionResourceKeys,
} from './endpoint-connection.js';
import type {
  MiotEventSchema,
  MiotPropertySchema,
  MiotSpecInstance,
  MiotSpecProperty,
  MiotSpecService,
} from './miot/index.js';
import {MiotProvider} from './provider.js';

const DEVICE_TYPE = 'urn:miot-spec-v2:device:light:0000A001:test-light:1';
const ALTERNATE_DEVICE_TYPE =
  'urn:miot-spec-v2:device:light:0000A001:alternate-light:1';
const LIGHT_SERVICE_TYPE = 'urn:miot-spec-v2:service:light:00007802';
const ENVIRONMENT_SERVICE_TYPE =
  'urn:miot-spec-v2:service:environment:0000780A';
const ON_PROPERTY_TYPE = 'urn:miot-spec-v2:property:on:00000006';
const MODE_PROPERTY_TYPE = 'urn:miot-spec-v2:property:mode:00000008';
const TEMPERATURE_PROPERTY_TYPE =
  'urn:miot-spec-v2:property:temperature:00000020';
const RELATIVE_HUMIDITY_PROPERTY_TYPE =
  'urn:miot-spec-v2:property:relative-humidity:0000000C';

const TEST_DEVICE = {did: 'physical', model: 'test.light'};

const LIGHT_PROPERTIES = {
  'urn:miot-spec-v2:service:light:00007802': {
    'urn:miot-spec-v2:property:on:00000006': 'on',
    'urn:miot-spec-v2:property:mode:00000008': {
      name: 'mode',
      optional: true,
    },
  },
} as const satisfies MiotPropertySchema;

const ENVIRONMENT_PROPERTIES = {
  'urn:miot-spec-v2:service:environment:0000780A': {
    'urn:miot-spec-v2:property:temperature:00000020': {
      name: 'temperature',
      optional: true,
    },
    'urn:miot-spec-v2:property:relative-humidity:0000000C': {
      name: 'relativeHumidity',
      optional: true,
    },
  },
} as const satisfies MiotPropertySchema;

const TEST_PROPERTIES = {
  ...LIGHT_PROPERTIES,
  ...ENVIRONMENT_PROPERTIES,
} as const satisfies MiotPropertySchema;

const TEST_EVENTS = {
  'urn:miot-spec-v2:service:light:00007802': {
    'urn:miot-spec-v2:event:changed:00005FFF': 'changed',
  },
} as const satisfies MiotEventSchema;

const _ALTERNATE_EVENTS = {
  'urn:miot-spec-v2:service:light:00007802': {
    'urn:miot-spec-v2:event:reset:00005FFE': 'reset',
  },
} as const satisfies MiotEventSchema;

const _ALTERNATE_SAME_ALIAS_EVENTS = {
  'urn:miot-spec-v2:service:light:00007802': {
    'urn:miot-spec-v2:event:reset:00005FFE': 'changed',
  },
} as const satisfies MiotEventSchema;

test('resolves one required service and one optional service', () => {
  const Connection = createConnection();
  const resources = resolveMiotEndpointConnectionResources(
    Connection,
    createSpec([createLightService(2), createEnvironmentService(4, 'both')]),
  );

  expect(resources).toMatchObject([
    {service: {iid: 2}, properties: {on: {iid: 1}, mode: {iid: 2}}},
    {
      service: {iid: 4},
      properties: {temperature: {iid: 1}, relativeHumidity: {iid: 2}},
    },
  ]);
});

test('allows an optional service to be absent', () => {
  expect(
    resolveMiotEndpointConnectionResources(
      createConnection(),
      createSpec([createLightService(2)]),
    ),
  ).toMatchObject([
    {service: {iid: 2}, properties: {on: {iid: 1}, mode: {iid: 2}}},
  ]);
});

test.each([
  ['missing', []],
  ['ambiguous', [createLightService(2), createLightService(3)]],
] as const)('rejects a %s required service', (_name, services) => {
  expect(
    resolveMiotEndpointConnectionResources(
      createConnection(),
      createSpec(services),
    ),
  ).toBeUndefined();
});

test('rejects ambiguous optional services instead of choosing a combination', () => {
  expect(
    resolveMiotEndpointConnectionResources(
      createConnection(),
      createSpec([
        createLightService(2),
        createEnvironmentService(4, 'temperature'),
        createEnvironmentService(5, 'relativeHumidity'),
      ]),
    ),
  ).toBeUndefined();
});

test('rejects two declarations that resolve to the same service', () => {
  const Connection = createConnection({
    ...LIGHT_PROPERTIES,
    'urn:miot-spec-v2:service:light:00007802:test-light:1': {
      'urn:miot-spec-v2:property:on:00000006': 'duplicateOn',
    },
  });

  expect(
    resolveMiotEndpointConnectionResources(
      Connection,
      createSpec([createLightService(2)]),
    ),
  ).toBeUndefined();
});

test('persists only device identity and derives resources from the full spec', () => {
  const Connection = createConnection();
  const services = [createLightService(2), createEnvironmentService(4, 'both')];
  const spec = createSpec(services);
  const metadata = createMiotEndpointConnectionMetadata(TEST_DEVICE, spec);
  const resolved = resolveMiotEndpointConnectionMetadata(
    Connection,
    metadata,
    spec,
  );

  expect(metadata).toEqual({
    version: 1,
    device: {...TEST_DEVICE, urn: DEVICE_TYPE},
  });
  expect(resolved.resources).toMatchObject([
    {service: {iid: 2}, properties: {on: {iid: 1}, mode: {iid: 2}}},
    {
      service: {iid: 4},
      properties: {temperature: {iid: 1}, relativeHumidity: {iid: 2}},
    },
  ]);
  expect(getMiotEndpointConnectionResourceKeys(resolved)).toEqual([
    JSON.stringify(['physical', 2]),
    JSON.stringify(['physical', 4]),
  ]);
});

test('restores a previously selected split environment without discovery', () => {
  const Connection = createConnection();
  const services = [
    createLightService(2),
    createEnvironmentService(4, 'temperature'),
    createEnvironmentService(5, 'relativeHumidity'),
  ];
  const metadata = createLegacyMetadata(services);

  expect(
    resolveMiotEndpointConnectionResources(Connection, createSpec(services)),
  ).toBeUndefined();
  expect(
    resolveMiotEndpointConnectionMetadata(Connection, metadata).resources,
  ).toMatchObject([
    {service: {iid: 2}, properties: {on: {iid: 1}, mode: {iid: 2}}},
    {service: {iid: 4}, properties: {temperature: {iid: 1}}},
    {service: {iid: 5}, properties: {relativeHumidity: {iid: 1}}},
  ]);
});

test('derives newly supported optional properties from persisted services', () => {
  const withoutMode = createConnection({
    'urn:miot-spec-v2:service:light:00007802': {
      'urn:miot-spec-v2:property:on:00000006': 'on',
    },
  });
  const withMode = createConnection();
  const services = [createLightService(2)];
  const spec = createSpec(services);
  const metadata = createMiotEndpointConnectionMetadata(TEST_DEVICE, spec);

  expect(
    resolveMiotEndpointConnectionMetadata(withoutMode, metadata, spec)
      .resources[0]?.properties,
  ).toEqual({on: expect.objectContaining({iid: 1})});

  expect(
    resolveMiotEndpointConnectionMetadata(withMode, metadata, spec).resources[0]
      ?.properties,
  ).toMatchObject({on: {iid: 1}, mode: {iid: 2}});
});

test('derives a newly supported optional physical service from the full spec', () => {
  const withoutEnvironment = createConnection(LIGHT_PROPERTIES);
  const withEnvironment = createConnection();
  const spec = createSpec([
    createLightService(2),
    createEnvironmentService(4, 'both'),
  ]);
  const metadata = createMiotEndpointConnectionMetadata(TEST_DEVICE, spec);
  const before = resolveMiotEndpointConnectionMetadata(
    withoutEnvironment,
    metadata,
    spec,
  );
  const after = resolveMiotEndpointConnectionMetadata(
    withEnvironment,
    metadata,
    spec,
  );

  expect(before.resources.map(resource => resource.service.iid)).toEqual([2]);
  expect(after.resources.map(resource => resource.service.iid)).toEqual([2, 4]);
  expect(getMiotEndpointConnectionResourceKeys(after)).toEqual([
    JSON.stringify(['physical', 2]),
    JSON.stringify(['physical', 4]),
  ]);
});

test('requires the full spec for current identity metadata', () => {
  const spec = createSpec([createLightService(2)]);
  const metadata = createMiotEndpointConnectionMetadata(TEST_DEVICE, spec);

  expect(() =>
    resolveMiotEndpointConnectionMetadata(
      createConnection(),
      metadata,
      createSpec([createLightService(2)], ALTERNATE_DEVICE_TYPE),
    ),
  ).toThrow('Invalid MIoT endpoint metadata spec.');
});

test('rejects metadata whose selected services no longer resolve', () => {
  const Connection = createConnection();
  const metadata = LegacyMiotEndpointConnectionMetadata.satisfies({
    device: {...TEST_DEVICE, urn: DEVICE_TYPE},
    resources: [{service: createEnvironmentService(4, 'temperature')}],
  });

  expect(() =>
    resolveMiotEndpointConnectionMetadata(Connection, metadata),
  ).toThrow('Invalid MIoT endpoint metadata.');
});

test('compares legacy service and property collections without order', () => {
  const metadata = createLegacyMetadata([
    createLightService(2),
    createEnvironmentService(4, 'both'),
  ]);
  const reordered = LegacyMiotEndpointConnectionMetadata.satisfies({
    ...metadata,
    resources: metadata.resources.toReversed().map(resource => ({
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

  const duplicateAccess = mapMetadataProperties(metadata, property => ({
    ...property,
    access: [...property.access, property.access[0] ?? 'read'],
  }));

  expect(
    miotEndpointConnectionMetadataEqual(duplicateAccess, duplicateAccess),
  ).toBe(true);
  expect(miotEndpointConnectionMetadataEqual(metadata, duplicateAccess)).toBe(
    true,
  );
});

test.each(['did', 'model', 'urn'] as const)(
  'compares metadata device %s exactly',
  field => {
    const metadata = createMiotEndpointConnectionMetadata(
      TEST_DEVICE,
      createSpec([createLightService(2)]),
    );
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

test('compares current metadata by identity and distinguishes legacy metadata', () => {
  const spec = createSpec([createLightService(2)]);
  const current = createMiotEndpointConnectionMetadata(TEST_DEVICE, spec);
  const sameIdentity = createMiotEndpointConnectionMetadata(TEST_DEVICE, {
    ...spec,
    description: 'Changed description',
    services: [...spec.services, createEnvironmentService(4, 'both')],
  });
  const legacy = createLegacyMetadata(spec.services);

  expect(miotEndpointConnectionMetadataEqual(current, sameIdentity)).toBe(true);
  expect(miotEndpointConnectionMetadataEqual(current, legacy)).toBe(false);
  expect(miotEndpointConnectionMetadataEqual(legacy, current)).toBe(false);
});

test('compares legacy value-list descriptions and value-range tuple positions', () => {
  const metadata = createLegacyMetadata([
    createLightService(2),
    createEnvironmentService(4, 'both'),
  ]);
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

test('compares legacy persisted action definitions', () => {
  const metadata = createLegacyMetadata([createLightService(2)]);
  const withAction = LegacyMiotEndpointConnectionMetadata.satisfies({
    ...metadata,
    resources: metadata.resources.map(resource => ({
      service: {
        ...resource.service,
        actions: [
          {
            iid: 1,
            type: 'urn:miot-spec-v2:action:toggle:00002803:test:1',
            description: 'Toggle',
            in: [1, 2],
            out: [],
          },
        ],
      },
    })),
  });
  const reorderedInputs = LegacyMiotEndpointConnectionMetadata.satisfies({
    ...withAction,
    resources: withAction.resources.map(resource => ({
      service: {
        ...resource.service,
        actions: resource.service.actions?.map(action => ({
          ...action,
          in: action.in.toReversed(),
        })),
      },
    })),
  });

  expect(miotEndpointConnectionMetadataEqual(metadata, withAction)).toBe(false);
  expect(miotEndpointConnectionMetadataEqual(withAction, withAction)).toBe(
    true,
  );
  expect(miotEndpointConnectionMetadataEqual(withAction, reorderedInputs)).toBe(
    false,
  );
});

test('rejects duplicate devices but allows device-specific connections', () => {
  class SpecializedLightEndpoint extends LightEndpoint {}
  class FirstDevice extends Device {}
  class SecondDevice extends Device {}

  const registry = new MiotDeviceRegistry();
  const first = createConnection();
  const sameEndpoint = createConnection(TEST_PROPERTIES, LightEndpoint);
  const specialized = createConnection(
    TEST_PROPERTIES,
    SpecializedLightEndpoint,
  );

  registry.register(FirstDevice, first);
  expect(() => registry.register(FirstDevice, specialized)).toThrow(
    'Duplicate MIoT device registration.',
  );
  expect(() => registry.register(SecondDevice, sameEndpoint)).not.toThrow();
  expect(
    registry.getEndpointConnection([FirstDevice], new LightEndpoint()),
  ).toBe(first);
  expect(
    registry.getEndpointConnection([SecondDevice], new LightEndpoint()),
  ).toBe(sameEndpoint);
  expect(
    registry.getEndpointConnection(
      [FirstDevice, SecondDevice],
      new LightEndpoint(),
    ),
  ).toBeUndefined();
});

test('requires the static and connection event schemas to match', () => {
  class EventDevice extends Device {}
  class MatchingConnection extends TestEventEndpointConnection<
    typeof TEST_EVENTS
  > {
    static readonly Endpoint = LightEndpoint;
    static readonly properties = LIGHT_PROPERTIES;
    static readonly events = TEST_EVENTS;
  }
  class MismatchedConnection extends TestEventEndpointConnection<
    typeof _ALTERNATE_EVENTS
  > {
    static readonly Endpoint = LightEndpoint;
    static readonly properties = LIGHT_PROPERTIES;
    static readonly events = TEST_EVENTS;
  }
  class ErasedConnection extends TestLightEndpointConnection {
    static readonly Endpoint = LightEndpoint;
    static readonly properties = LIGHT_PROPERTIES;
    static readonly events = TEST_EVENTS;
  }
  class SameAliasMismatchedConnection extends TestEventEndpointConnection<
    typeof _ALTERNATE_SAME_ALIAS_EVENTS
  > {
    static readonly Endpoint = LightEndpoint;
    static readonly properties = LIGHT_PROPERTIES;
    static readonly events = TEST_EVENTS;
  }
  class MissingStaticEventsConnection extends TestEventEndpointConnection<
    typeof TEST_EVENTS
  > {
    static readonly Endpoint = LightEndpoint;
    static readonly properties = LIGHT_PROPERTIES;
  }

  const registry = new MiotDeviceRegistry();
  registry.register(EventDevice, MatchingConnection);
  expect(
    registry.getEndpointConnection([EventDevice], new LightEndpoint()),
  ).toBe(MatchingConnection);

  // @ts-expect-error -- Static aliases differ from the instance event schema.
  new MiotDeviceRegistry().register(EventDevice, MismatchedConnection);
  // @ts-expect-error -- A static event schema must not use the erased default.
  new MiotDeviceRegistry().register(EventDevice, ErasedConnection);
  // @ts-expect-error -- Matching aliases do not make different schemas equal.
  new MiotDeviceRegistry().register(EventDevice, SameAliasMismatchedConnection);
  // @ts-expect-error -- A narrow instance event schema requires static events.
  new MiotDeviceRegistry().register(EventDevice, MissingStaticEventsConnection);
});

test('matches every registered endpoint once without sharing services', () => {
  class MultiEndpointDevice extends Device {}
  class EnvironmentEndpoint extends LightEndpoint {}

  const registry = new MiotDeviceRegistry();
  const LightConnection = createConnection(LIGHT_PROPERTIES);
  const EnvironmentConnection = createConnection(
    ENVIRONMENT_PROPERTIES,
    EnvironmentEndpoint,
  );
  const lightEndpoint = {endpoint: new LightEndpoint()};
  const environmentEndpoint = {endpoint: new EnvironmentEndpoint()};

  registry.register(
    MultiEndpointDevice,
    LightConnection,
    EnvironmentConnection,
  );

  const match = registry.match(
    {
      deviceConstructors: [MultiEndpointDevice],
      endpoints: [environmentEndpoint, lightEndpoint],
    },
    createSpec([createLightService(2), createEnvironmentService(4, 'both')]),
  );

  expect(match?.endpoints.map(item => item.endpoint)).toEqual([
    environmentEndpoint,
    lightEndpoint,
  ]);

  const OverlappingConnection = createConnection(
    LIGHT_PROPERTIES,
    EnvironmentEndpoint,
  );
  const overlappingRegistry = new MiotDeviceRegistry();

  overlappingRegistry.register(
    MultiEndpointDevice,
    LightConnection,
    OverlappingConnection,
  );
  expect(
    overlappingRegistry.match(
      {
        deviceConstructors: [MultiEndpointDevice],
        endpoints: [lightEndpoint, environmentEndpoint],
      },
      createSpec([createLightService(2)]),
    ),
  ).toBeUndefined();
});

test('allows one connection to be reused across devices but not duplicated within one device', () => {
  class FirstDevice extends Device {}
  class SecondDevice extends Device {}
  class InvalidDevice extends Device {}

  const registry = new MiotDeviceRegistry();
  const Connection = createConnection();

  registry.register(FirstDevice, Connection);
  expect(() => registry.register(SecondDevice, Connection)).not.toThrow();
  expect(() =>
    registry.register(InvalidDevice, Connection, Connection),
  ).toThrow('Duplicate MIoT endpoint connection registration.');
});

test('disposes local connection state after asynchronous subscription cleanup', async () => {
  const order: string[] = [];
  const cleanupError = new Error('Subscription cleanup failed.');
  let releaseCleanup: (() => void) | undefined;
  const cleanupGate = new Promise<void>(resolve => {
    releaseCleanup = resolve;
  });

  class DisposableConnection extends TestLightEndpointConnection {
    static readonly Endpoint = LightEndpoint;
    static readonly properties = LIGHT_PROPERTIES;

    override dispose(): void {
      order.push('connection');
    }
  }

  const resources = requireResources(DisposableConnection, [
    createLightService(2),
  ]);
  const spec = createSpec(resources.map(resource => resource.service));
  const metadata = resolveMiotEndpointConnectionMetadata(
    DisposableConnection,
    createMiotEndpointConnectionMetadata(TEST_DEVICE, spec),
    spec,
  );
  const {binding} = createMiotDeviceEndpointConnectionBinding(
    DisposableConnection,
    new MiotProvider('provider'),
    new LightEndpoint(),
    metadata,
    [
      {
        executeRequest: () => Promise.resolve({code: 0}),
      },
    ],
    async () => {
      order.push('cleanup-start');
      await cleanupGate;
      order.push('cleanup-end');
      throw cleanupError;
    },
  );

  binding.bind();
  const disposal = binding.dispose();

  expect(order).toEqual(['cleanup-start']);
  releaseCleanup?.();
  await expect(disposal).rejects.toBe(cleanupError);
  expect(order).toEqual(['cleanup-start', 'cleanup-end', 'connection']);
});

function createConnection(
  properties: MiotPropertySchema = TEST_PROPERTIES,
  EndpointConstructor: new (
    name?: string,
  ) => LightEndpoint<LightEndpointConnection> = LightEndpoint,
): MiotEndpointConnectionConstructor {
  return class extends TestLightEndpointConnection {
    static readonly Endpoint = EndpointConstructor;
    static readonly properties = properties;
  };
}

function requireResources(
  Connection: MiotEndpointConnectionConstructor,
  services: readonly MiotSpecService[],
): readonly MiotEndpointConnectionResolvedResource[] {
  const resources = resolveMiotEndpointConnectionResources(
    Connection,
    createSpec(services),
  );

  if (resources === undefined) {
    throw new Error('Test connection did not resolve resources.');
  }

  return resources;
}

function createSpec(
  services: readonly MiotSpecService[],
  type = DEVICE_TYPE,
): MiotSpecInstance {
  return {type, description: 'Test device', services: [...services]};
}

function createLegacyMetadata(
  services: readonly MiotSpecService[],
  urn = DEVICE_TYPE,
): LegacyMiotEndpointConnectionMetadata {
  return LegacyMiotEndpointConnectionMetadata.satisfies({
    device: {...TEST_DEVICE, urn},
    resources: services.map(service => ({service})),
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

  override prepareCommand(_command: LightEndpointCommand): CommandExecution {
    return {execute: () => Promise.resolve()};
  }
}

abstract class TestEventEndpointConnection<TEventSchema extends MiotEventSchema>
  extends MiotEndpointConnection<
    LightEndpointCommand,
    typeof LIGHT_PROPERTIES,
    TEventSchema
  >
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

  override prepareCommand(_command: LightEndpointCommand): CommandExecution {
    return {execute: () => Promise.resolve()};
  }
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

function createEnvironmentService(
  iid: number,
  features: 'temperature' | 'relativeHumidity' | 'both',
): MiotSpecService {
  const properties: MiotSpecProperty[] = [];

  if (features === 'temperature' || features === 'both') {
    properties.push({
      iid: 1,
      type: `${TEMPERATURE_PROPERTY_TYPE}:test-light:1`,
      description: 'Temperature',
      format: 'float',
      access: ['read', 'notify'],
      unit: 'celsius',
      'value-range': [-30, 100, 0.1],
    });
  }

  if (features === 'relativeHumidity' || features === 'both') {
    properties.push({
      iid: features === 'both' ? 2 : 1,
      type: `${RELATIVE_HUMIDITY_PROPERTY_TYPE}:test-light:1`,
      description: 'Relative Humidity',
      format: 'uint8',
      access: ['read', 'notify'],
      unit: 'percentage',
      'value-range': [0, 100, 1],
    });
  }

  return {
    iid,
    type: `${ENVIRONMENT_SERVICE_TYPE}:test-light:1`,
    description: `Environment ${iid}`,
    properties,
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
  metadata: LegacyMiotEndpointConnectionMetadata,
  callback: (property: MiotSpecProperty) => MiotSpecProperty,
): LegacyMiotEndpointConnectionMetadata {
  return LegacyMiotEndpointConnectionMetadata.satisfies({
    ...metadata,
    resources: metadata.resources.map(resource => ({
      service: {
        ...resource.service,
        properties: resource.service.properties?.map(callback),
      },
    })),
  });
}
