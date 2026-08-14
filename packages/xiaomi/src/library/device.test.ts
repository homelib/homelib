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
  createMiotEndpointConnectionMetadata,
  miotEndpointConnectionMetadataEqual,
  resolveMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionResources,
} from './device.js';
import {
  MiotEndpointConnection,
  MiotEndpointConnectionMetadata,
  type MiotEndpointConnectionResolvedResource,
  getMiotEndpointConnectionResourceKeys,
} from './endpoint-connection.js';
import type {
  MiotPropertySchema,
  MiotSpecProperty,
  MiotSpecService,
} from './miot/index.js';

const DEVICE_TYPE = 'urn:miot-spec-v2:device:light:0000A001:test-light:1';
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
  [LIGHT_SERVICE_TYPE]: {
    [ON_PROPERTY_TYPE]: 'on',
    [MODE_PROPERTY_TYPE]: {
      name: 'mode',
      enum: {off: 0, on: 1},
      optional: true,
    },
  },
} as const satisfies MiotPropertySchema;

const ENVIRONMENT_PROPERTIES = {
  [ENVIRONMENT_SERVICE_TYPE]: {
    [TEMPERATURE_PROPERTY_TYPE]: {
      name: 'temperature',
      optional: true,
    },
    [RELATIVE_HUMIDITY_PROPERTY_TYPE]: {
      name: 'relativeHumidity',
      optional: true,
    },
  },
} as const satisfies MiotPropertySchema;

const TEST_PROPERTIES = {
  ...LIGHT_PROPERTIES,
  ...ENVIRONMENT_PROPERTIES,
} as const satisfies MiotPropertySchema;

test('resolves one required service and one optional service', () => {
  const Connection = createConnection();
  const resources = resolveMiotEndpointConnectionResources(Connection, [
    createLightService(2),
    createEnvironmentService(4, 'both'),
  ]);

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
    resolveMiotEndpointConnectionResources(createConnection(), [
      createLightService(2),
    ]),
  ).toMatchObject([
    {service: {iid: 2}, properties: {on: {iid: 1}, mode: {iid: 2}}},
  ]);
});

test.each([
  ['missing', []],
  ['ambiguous', [createLightService(2), createLightService(3)]],
] as const)('rejects a %s required service', (_name, services) => {
  expect(
    resolveMiotEndpointConnectionResources(createConnection(), services),
  ).toBeUndefined();
});

test('rejects ambiguous optional services instead of choosing a combination', () => {
  expect(
    resolveMiotEndpointConnectionResources(createConnection(), [
      createLightService(2),
      createEnvironmentService(4, 'temperature'),
      createEnvironmentService(5, 'relativeHumidity'),
    ]),
  ).toBeUndefined();
});

test('rejects two declarations that resolve to the same service', () => {
  const Connection = createConnection({
    ...LIGHT_PROPERTIES,
    [`${LIGHT_SERVICE_TYPE}:test-light:1`]: {
      [ON_PROPERTY_TYPE]: 'duplicateOn',
    },
  });

  expect(
    resolveMiotEndpointConnectionResources(Connection, [createLightService(2)]),
  ).toBeUndefined();
});

test('persists only physical services and derives aliases on restore', () => {
  const Connection = createConnection();
  const services = [createLightService(2), createEnvironmentService(4, 'both')];
  const resources = requireResources(Connection, services);
  const metadata = createMiotEndpointConnectionMetadata(
    TEST_DEVICE,
    DEVICE_TYPE,
    resources,
  );

  expect(metadata.resources).toEqual(services.map(service => ({service})));
  expect(
    resolveMiotEndpointConnectionMetadata(Connection, metadata).resources,
  ).toMatchObject([
    {service: {iid: 2}, properties: {on: {iid: 1}, mode: {iid: 2}}},
    {
      service: {iid: 4},
      properties: {temperature: {iid: 1}, relativeHumidity: {iid: 2}},
    },
  ]);
  expect(getMiotEndpointConnectionResourceKeys(metadata)).toEqual([
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
  const metadata = MiotEndpointConnectionMetadata.satisfies({
    device: {...TEST_DEVICE, urn: DEVICE_TYPE},
    resources: services.map(service => ({service})),
  });

  expect(
    resolveMiotEndpointConnectionResources(Connection, services),
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
    [LIGHT_SERVICE_TYPE]: {[ON_PROPERTY_TYPE]: 'on'},
  });
  const withMode = createConnection();
  const services = [createLightService(2)];
  const metadata = createMiotEndpointConnectionMetadata(
    TEST_DEVICE,
    DEVICE_TYPE,
    requireResources(withoutMode, services),
  );

  expect(
    resolveMiotEndpointConnectionMetadata(withMode, metadata).resources[0]
      ?.properties,
  ).toMatchObject({on: {iid: 1}, mode: {iid: 2}});
});

test('rejects metadata whose selected services no longer resolve', () => {
  const Connection = createConnection();
  const metadata = MiotEndpointConnectionMetadata.satisfies({
    device: {...TEST_DEVICE, urn: DEVICE_TYPE},
    resources: [{service: createEnvironmentService(4, 'temperature')}],
  });

  expect(() =>
    resolveMiotEndpointConnectionMetadata(Connection, metadata),
  ).toThrow('Invalid MIoT endpoint metadata.');
});

test('compares service and property collections without order', () => {
  const Connection = createConnection();
  const metadata = createMiotEndpointConnectionMetadata(
    TEST_DEVICE,
    DEVICE_TYPE,
    requireResources(Connection, [
      createLightService(2),
      createEnvironmentService(4, 'both'),
    ]),
  );
  const reordered = MiotEndpointConnectionMetadata.satisfies({
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
    const Connection = createConnection();
    const metadata = createMiotEndpointConnectionMetadata(
      TEST_DEVICE,
      DEVICE_TYPE,
      requireResources(Connection, [createLightService(2)]),
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

test('compares value-list descriptions and value-range tuple positions', () => {
  const Connection = createConnection();
  const metadata = createMiotEndpointConnectionMetadata(
    TEST_DEVICE,
    DEVICE_TYPE,
    requireResources(Connection, [
      createLightService(2),
      createEnvironmentService(4, 'both'),
    ]),
  );
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
    [createLightService(2), createEnvironmentService(4, 'both')],
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
      [createLightService(2)],
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
    services,
  );

  if (resources === undefined) {
    throw new Error('Test connection did not resolve resources.');
  }

  return resources;
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
