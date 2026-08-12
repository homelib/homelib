import {
  DeviceEntry,
  type EndpointConnection,
  Light,
  LightEndpoint,
  type LightEndpointCommand,
  SetLightBrightnessCommand,
  SetLightColorTemperatureCommand,
  SetLightOnCommand,
} from '@homelib/core';
import {autorun} from 'mobx';

import {
  CloudDeviceChannel,
  type CloudDeviceMessageSource,
} from './cloud/device.js';
import type {CloudMqttDeviceMessageHandler} from './cloud/mqtt.js';
import type {MiotPlaceholderCommand} from './command.js';
import {MiotLightEndpointConnection} from './devices/index.js';
import {
  MiotEndpointConnection,
  MiotEndpointConnectionMetadata,
  type MiotEndpointConnectionResolvedMetadata,
  type MiotEndpointConnectionResolvedResource,
  MiotEndpointConnectionTransport,
  createMiotEndpointConnectionResolvedMetadata,
  getMiotEndpointConnectionProperty,
  getMiotEndpointConnectionResourceKeys,
  normalizeMiotEndpointConnectionMetadata,
} from './endpoint-connection.js';
import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  MiotSetPropertyRequest,
  type MiotSpecProperty,
} from './miot/index.js';
import {MiotProvider} from './provider.js';

const TEST_METADATA = createTestResolvedMetadata({
  device: {
    did: 'device-1',
    model: 'test.light',
    urn: 'urn:miot-spec-v2:device:light:0000A001:test-light:1',
  },
  resources: [
    {
      service: {
        iid: 2,
        type: 'urn:miot-spec-v2:service:light:00007802',
        description: 'Light',
        properties: [
          {
            iid: 1,
            type: 'urn:miot-spec-v2:property:on:00000006',
            description: 'Switch Status',
            format: 'bool',
            access: ['read', 'write', 'notify'],
          },
        ],
      },
      properties: {
        on: {
          iid: 1,
          type: 'urn:miot-spec-v2:property:on:00000006',
          description: 'Switch Status',
          format: 'bool',
          access: ['read', 'write', 'notify'],
        },
      },
    },
  ],
});

const TEST_PRIMARY_RESOURCE = getResource(TEST_METADATA, 0);

const TEST_DIMMABLE_METADATA = createTestResolvedMetadata({
  ...TEST_METADATA,
  resources: [
    {
      service: {
        ...TEST_PRIMARY_RESOURCE.service,
        properties: [
          ...(TEST_PRIMARY_RESOURCE.service.properties ?? []),
          {
            iid: 2,
            type: 'urn:miot-spec-v2:property:brightness:0000000D',
            description: 'Brightness',
            format: 'uint8',
            access: ['read', 'write', 'notify'],
            unit: 'percentage',
            'value-range': [1, 100, 1],
          },
          {
            iid: 3,
            type: 'urn:miot-spec-v2:property:color-temperature:0000000F',
            description: 'Color Temperature',
            format: 'uint32',
            access: ['read', 'write', 'notify'],
            unit: 'kelvin',
            'value-range': [2600, 6100, 100],
          },
        ],
      },
      properties: {
        ...TEST_PRIMARY_RESOURCE.properties,
        brightness: {
          iid: 2,
          type: 'urn:miot-spec-v2:property:brightness:0000000D',
          description: 'Brightness',
          format: 'uint8',
          access: ['read', 'write', 'notify'],
          unit: 'percentage',
          'value-range': [1, 100, 1],
        },
        colorTemperature: {
          iid: 3,
          type: 'urn:miot-spec-v2:property:color-temperature:0000000F',
          description: 'Color Temperature',
          format: 'uint32',
          access: ['read', 'write', 'notify'],
          unit: 'kelvin',
          'value-range': [2600, 6100, 100],
        },
      },
    },
  ],
});

const TEST_DIMMABLE_PRIMARY_RESOURCE = getResource(TEST_DIMMABLE_METADATA, 0);

const TEST_VALUE_LIST_METADATA = createTestResolvedMetadata({
  device: {
    did: 'fan-1',
    model: 'test.fan',
    urn: 'urn:miot-spec-v2:device:fan:0000A005:test-fan:1',
  },
  resources: [
    {
      service: {
        iid: 2,
        type: 'urn:miot-spec-v2:service:fan:00007808:test-fan:1',
        description: 'Fan',
        properties: [
          {
            iid: 3,
            type: 'urn:miot-spec-v2:property:mode:00000008:test-fan:1',
            description: 'Mode',
            format: 'uint8',
            access: ['read', 'write', 'notify'],
            'value-list': [
              {value: 0, description: 'Straight Wind'},
              {value: 1, description: 'Natural Wind'},
            ],
          },
        ],
      },
      properties: {
        mode: {
          iid: 3,
          type: 'urn:miot-spec-v2:property:mode:00000008:test-fan:1',
          description: 'Mode',
          format: 'uint8',
          access: ['read', 'write', 'notify'],
          'value-list': [
            {value: 0, description: 'Straight Wind'},
            {value: 1, description: 'Natural Wind'},
          ],
        },
      },
    },
  ],
});

const TEST_VALUE_LIST_PRIMARY_RESOURCE = getResource(
  TEST_VALUE_LIST_METADATA,
  0,
);

const TEST_ENVIRONMENT_TEMPERATURE_PROPERTY = {
  iid: 1,
  type: 'urn:miot-spec-v2:property:temperature:00000020',
  description: 'Temperature',
  format: 'float',
  access: ['read', 'notify'],
  unit: 'celsius',
  'value-range': [-30, 100, 0.1],
} satisfies MiotSpecProperty;
const TEST_ENVIRONMENT_HUMIDITY_PROPERTY = {
  iid: 2,
  type: 'urn:miot-spec-v2:property:relative-humidity:0000000C',
  description: 'Relative Humidity',
  format: 'uint8',
  access: ['read', 'notify'],
  unit: 'percentage',
  'value-range': [0, 100, 1],
} satisfies MiotSpecProperty;
const TEST_ENVIRONMENT_RESOURCE: MiotEndpointConnectionResolvedResource = {
  service: {
    iid: 3,
    type: 'urn:miot-spec-v2:service:environment:0000780A',
    description: 'Environment',
    properties: [
      TEST_ENVIRONMENT_TEMPERATURE_PROPERTY,
      TEST_ENVIRONMENT_HUMIDITY_PROPERTY,
    ],
  },
  properties: {
    temperature: TEST_ENVIRONMENT_TEMPERATURE_PROPERTY,
    humidity: TEST_ENVIRONMENT_HUMIDITY_PROPERTY,
  },
};
const TEST_MULTI_RESOURCE_METADATA = createTestResolvedMetadata({
  ...TEST_METADATA,
  resources: [TEST_PRIMARY_RESOURCE, TEST_ENVIRONMENT_RESOURCE],
});

test('normalizes persisted metadata and strips legacy property aliases', () => {
  const serialized = JSON.stringify(TEST_MULTI_RESOURCE_METADATA);
  const metadata = normalizeMiotEndpointConnectionMetadata(
    JSON.parse(serialized) as unknown,
  );

  expect(metadata.resources).toMatchObject([
    {service: {iid: 2}},
    {service: {iid: 3}},
  ]);
  expect(
    metadata.resources.every(
      resource => !Object.hasOwn(resource, 'properties'),
    ),
  ).toBe(true);
  expect(getMiotEndpointConnectionResourceKeys(metadata)).toEqual([
    JSON.stringify([TEST_METADATA.device.did, 2]),
    JSON.stringify([TEST_METADATA.device.did, 3]),
  ]);
});

test('resource keys are canonical regardless of metadata order', () => {
  const metadata = MiotEndpointConnectionMetadata.satisfies({
    ...TEST_MULTI_RESOURCE_METADATA,
    resources: [...TEST_MULTI_RESOURCE_METADATA.resources].reverse(),
  });

  expect(getMiotEndpointConnectionResourceKeys(metadata)).toEqual([
    JSON.stringify([TEST_METADATA.device.did, 2]),
    JSON.stringify([TEST_METADATA.device.did, 3]),
  ]);
});

test('rejects metadata without any resources', () => {
  expect(() =>
    MiotEndpointConnectionMetadata.satisfies({
      ...TEST_METADATA,
      resources: [],
    }),
  ).toThrow('MIoT endpoint metadata requires at least one resource.');
});

test('rejects legacy single-service endpoint metadata', () => {
  expect(() =>
    MiotEndpointConnectionMetadata.satisfies({
      device: TEST_METADATA.device,
      service: TEST_PRIMARY_RESOURCE.service,
      properties: TEST_PRIMARY_RESOURCE.properties,
    }),
  ).toThrow();
});

test('flattens state properties across all resources', () => {
  const connection = createMultiResourceConnection();

  expect(connection.stateProperties).toEqual([
    {did: TEST_METADATA.device.did, siid: 2, piid: 1},
    {did: TEST_METADATA.device.did, siid: 3, piid: 1},
    {did: TEST_METADATA.device.did, siid: 3, piid: 2},
  ]);
});

test('subscribes to derived aliases instead of every persisted property', () => {
  const on = TEST_PRIMARY_RESOURCE.properties.on;
  const brightness = TEST_DIMMABLE_PRIMARY_RESOURCE.properties.brightness;

  if (on === undefined || brightness === undefined) {
    throw new Error('Test light properties are incomplete.');
  }

  const metadata = createTestResolvedMetadata({
    ...TEST_DIMMABLE_METADATA,
    resources: [
      {
        service: TEST_DIMMABLE_PRIMARY_RESOURCE.service,
        properties: {on},
      },
    ],
  });
  const connection = new TestMultiResourceEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [new TestTransport()],
  );

  expect(connection.stateProperties).toEqual([
    {did: TEST_METADATA.device.did, siid: 2, piid: 1},
  ]);
  expect(() =>
    connection.handlePropertyUpdate({
      did: TEST_METADATA.device.did,
      siid: 2,
      piid: brightness.iid,
      value: 50,
    }),
  ).toThrow('Unexpected MIoT endpoint property update.');
});

test('resolves state aliases by service and property iid', () => {
  const connection = createMultiResourceConnection();

  connection.handlePropertyUpdate({
    did: TEST_METADATA.device.did,
    siid: 2,
    piid: 1,
    value: true,
  });
  connection.handlePropertyUpdate({
    did: TEST_METADATA.device.did,
    siid: 3,
    piid: 1,
    value: 23.5,
  });

  expect(connection.on).toBe(true);
  expect(connection.temperature).toBe(23.5);
});

test('rejects duplicate physical services and derived state aliases', () => {
  expect(() =>
    MiotEndpointConnectionMetadata.satisfies({
      ...TEST_MULTI_RESOURCE_METADATA,
      resources: [
        TEST_PRIMARY_RESOURCE,
        {
          ...TEST_ENVIRONMENT_RESOURCE,
          service: {...TEST_ENVIRONMENT_RESOURCE.service, iid: 2},
        },
      ],
    }),
  ).toThrow('Duplicate MIoT endpoint metadata service.');

  expect(() =>
    createMiotEndpointConnectionResolvedMetadata(
      normalizeMiotEndpointConnectionMetadata(TEST_MULTI_RESOURCE_METADATA),
      [
        TEST_PRIMARY_RESOURCE,
        {
          ...TEST_ENVIRONMENT_RESOURCE,
          properties: {on: TEST_ENVIRONMENT_TEMPERATURE_PROPERTY},
        },
      ],
    ),
  ).toThrow('Ambiguous resolved MIoT endpoint property.');

  expect(() =>
    createMiotEndpointConnectionResolvedMetadata(
      normalizeMiotEndpointConnectionMetadata(TEST_MULTI_RESOURCE_METADATA),
      [TEST_PRIMARY_RESOURCE, TEST_PRIMARY_RESOURCE],
    ),
  ).toThrow('Duplicate resolved MIoT endpoint resource.');
});

test('allows writable properties on every flat resource', () => {
  const writableTemperature = {
    ...TEST_ENVIRONMENT_TEMPERATURE_PROPERTY,
    access: ['read', 'write', 'notify'],
  };

  const metadata = createTestResolvedMetadata({
    ...TEST_MULTI_RESOURCE_METADATA,
    resources: [
      TEST_PRIMARY_RESOURCE,
      {
        ...TEST_ENVIRONMENT_RESOURCE,
        service: {
          ...TEST_ENVIRONMENT_RESOURCE.service,
          properties: [writableTemperature, TEST_ENVIRONMENT_HUMIDITY_PROPERTY],
        },
        properties: {
          ...TEST_ENVIRONMENT_RESOURCE.properties,
          temperature: writableTemperature,
        },
      },
    ],
  });

  expect(
    getMiotEndpointConnectionProperty(metadata, 'temperature'),
  ).toMatchObject({service: {iid: 3}, property: {iid: 1}});
});

test('commits a full multi-resource initial state and ready flag atomically', () => {
  const connection = createMultiResourceConnection();
  const values: Array<readonly [boolean, boolean, number, number]> = [];
  const disposeAutorun = autorun(() => {
    values.push([
      connection.ready,
      connection.on,
      connection.temperature,
      connection.humidity,
    ]);
  });

  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [
      {did: TEST_METADATA.device.did, siid: 2, piid: 1, value: true},
      {did: TEST_METADATA.device.did, siid: 3, piid: 1, value: 24.5},
      {did: TEST_METADATA.device.did, siid: 3, piid: 2, value: 55},
    ],
  });

  expect(values).toEqual([
    [false, false, 0, 0],
    [true, true, 24.5, 55],
  ]);
  disposeAutorun();
});

test('declares the supported endpoint', () => {
  expect(MiotLightEndpointConnection.Endpoint).toBe(LightEndpoint);
});

test('locates a named property in its owning service', () => {
  expect(
    getMiotEndpointConnectionProperty(TEST_MULTI_RESOURCE_METADATA, 'on'),
  ).toMatchObject({service: {iid: 2}, property: {iid: 1}});
  expect(
    getMiotEndpointConnectionProperty(
      TEST_MULTI_RESOURCE_METADATA,
      'temperature',
    ),
  ).toMatchObject({service: {iid: 3}, property: {iid: 1}});
  expect(() =>
    getMiotEndpointConnectionProperty(TEST_MULTI_RESOURCE_METADATA, 'missing'),
  ).toThrow('Unknown MIoT endpoint property: missing.');
});

test('rejects a derived property that is not part of its physical service', () => {
  expect(() =>
    createMiotEndpointConnectionResolvedMetadata(
      normalizeMiotEndpointConnectionMetadata({
        ...TEST_METADATA,
        resources: [
          {
            service: {...TEST_PRIMARY_RESOURCE.service, properties: []},
          },
        ],
      }),
      [
        {
          ...TEST_PRIMARY_RESOURCE,
          service: {...TEST_PRIMARY_RESOURCE.service, properties: []},
        },
      ],
    ),
  ).toThrow('Resolved MIoT endpoint property does not belong to its service.');
});

test('translates light commands to MIoT requests', async () => {
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [transport],
  );

  await connection.processCommand(new SetLightOnCommand(true));

  expect(transport.requests).toEqual([
    new MiotSetPropertyRequest(
      {
        did: TEST_METADATA.device.did,
        siid: TEST_PRIMARY_RESOURCE.service.iid,
        piid: 1,
      },
      true,
    ),
  ]);
});

test('normalizes brightness requests against the raw maximum', async () => {
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [transport],
  );

  await connection.processCommand(new SetLightBrightnessCommand(0.01));
  await connection.processCommand(new SetLightBrightnessCommand(0.5));
  await connection.processCommand(new SetLightBrightnessCommand(1));

  expect(transport.requests).toEqual([
    createExpectedSetPropertyRequest(2, 1),
    createExpectedSetPropertyRequest(2, 50),
    createExpectedSetPropertyRequest(2, 100),
  ]);
});

test('supports a uint16 brightness range and raises small positive values to its minimum', async () => {
  const metadata = createMetadataWithBrightnessRange([1, 65_535, 1]);
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [transport],
  );

  await connection.processCommand(new SetLightBrightnessCommand(1 / 65_535));
  await connection.processCommand(new SetLightBrightnessCommand(0.5));
  await connection.processCommand(
    new SetLightBrightnessCommand(Number.MIN_VALUE),
  );

  expect(transport.requests).toEqual([
    createExpectedSetPropertyRequest(2, 1),
    createExpectedSetPropertyRequest(2, 32_768),
    createExpectedSetPropertyRequest(2, 1),
  ]);
});

test('clamps brightness to a non-zero device minimum before quantizing', async () => {
  const metadata = createMetadataWithBrightnessRange([20, 100, 5]);
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [transport],
  );

  await connection.processCommand(
    new SetLightBrightnessCommand(Number.MIN_VALUE),
  );
  await connection.processCommand(new SetLightBrightnessCommand(0.23));
  await connection.processCommand(new SetLightBrightnessCommand(1));

  expect(transport.requests).toEqual([
    createExpectedSetPropertyRequest(2, 20),
    createExpectedSetPropertyRequest(2, 25),
    createExpectedSetPropertyRequest(2, 100),
  ]);
});

test('quantizes color temperature requests to the nearest valid step', async () => {
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [transport],
  );

  await connection.processCommand(new SetLightColorTemperatureCommand(4_049));
  await connection.processCommand(new SetLightColorTemperatureCommand(4_050));

  expect(transport.requests).toEqual([
    createExpectedSetPropertyRequest(3, 4_000),
    createExpectedSetPropertyRequest(3, 4_100),
  ]);
});

test('rejects unsupported light property commands and clamps device ranges', async () => {
  const unsupportedTransport = new TestTransport();
  const unsupportedConnection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [unsupportedTransport],
  );
  const dimmableTransport = new TestTransport();
  const dimmableConnection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [dimmableTransport],
  );

  await expect(
    unsupportedConnection.processCommand(new SetLightBrightnessCommand(0.5)),
  ).rejects.toThrow('MIoT light does not support brightness.');
  await expect(
    unsupportedConnection.processCommand(
      new SetLightColorTemperatureCommand(4_000),
    ),
  ).rejects.toThrow('MIoT light does not support color temperature.');
  await dimmableConnection.processCommand(
    new SetLightColorTemperatureCommand(2_599),
  );
  await dimmableConnection.processCommand(
    new SetLightColorTemperatureCommand(6_101),
  );

  expect(unsupportedTransport.requests).toEqual([]);
  expect(dimmableTransport.requests).toEqual([
    createExpectedSetPropertyRequest(3, 2_600),
    createExpectedSetPropertyRequest(3, 6_100),
  ]);
});

test('does not expose provider-wide commands', () => {
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [new TestTransport()],
  );

  // @ts-expect-error -- A light connection cannot process MIoT-only commands.
  const widenedConnection: EndpointConnection<
    LightEndpointCommand | MiotPlaceholderCommand
  > = connection;

  expect(widenedConnection).toBe(connection);
});

test('projects snapshot and MQTT updates to observable light state', async () => {
  const entry = new DeviceEntry('light');
  const light = entry.createInstance(Light);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof LightEndpoint)) {
    throw new Error('Light endpoint was not created.');
  }

  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [new TestTransport()],
  );
  endpoint.bindConnection(connection);

  let messageHandler: CloudMqttDeviceMessageHandler | undefined;
  const messageSource: CloudDeviceMessageSource = {
    subscribeDevice: async (_did, handler) => {
      messageHandler = handler;
    },
    unsubscribeDevice: async _did => undefined,
  };
  const channel = new CloudDeviceChannel(
    TEST_METADATA.device.did,
    messageSource,
    async properties =>
      properties.map(property => ({...property, value: false, code: 0})),
    async () => true,
    () => undefined,
  );
  const values: Array<readonly [ready: boolean, on: boolean]> = [];
  const disposeAutorun = autorun(() => {
    values.push([light.ready, light.on]);
  });
  const subscription = await channel.subscribe(connection.stateProperties, {
    onStateChanged: state => {
      connection.handleStateUpdate(state);
    },
    onPropertyChanged: update => {
      connection.handlePropertyUpdate(update);
    },
  });

  const handler = messageHandler;

  if (handler === undefined) {
    throw new Error('Cloud MQTT handler was not registered.');
  }

  const [property] = connection.stateProperties;

  if (property === undefined) {
    throw new Error('MIoT light state property is missing.');
  }

  handler({...property, type: 'property', value: true});

  expect(values).toEqual([
    [false, false],
    [true, false],
    [true, true],
  ]);

  disposeAutorun();
  await subscription.dispose();
});

test('commits the initial light state and ready flag atomically', () => {
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [new TestTransport()],
  );
  const values: Array<
    readonly [boolean, boolean, number | undefined, number | undefined]
  > = [];
  const disposeAutorun = autorun(() => {
    values.push([
      connection.ready,
      connection.on,
      connection.brightness,
      connection.colorTemperature,
    ]);
  });

  connection.handleStateUpdate({
    did: TEST_DIMMABLE_METADATA.device.did,
    online: true,
    properties: [
      {
        did: TEST_DIMMABLE_METADATA.device.did,
        siid: TEST_DIMMABLE_PRIMARY_RESOURCE.service.iid,
        piid: 1,
        value: true,
      },
      {
        did: TEST_DIMMABLE_METADATA.device.did,
        siid: TEST_DIMMABLE_PRIMARY_RESOURCE.service.iid,
        piid: 2,
        value: 40,
      },
      {
        did: TEST_DIMMABLE_METADATA.device.did,
        siid: TEST_DIMMABLE_PRIMARY_RESOURCE.service.iid,
        piid: 3,
        value: 4_000,
      },
    ],
  });

  expect(values).toEqual([
    [false, false, 0, 2_600],
    [true, true, 0.4, 4_000],
  ]);

  connection.handleStateUpdate({
    did: TEST_DIMMABLE_METADATA.device.did,
    online: false,
    properties: [],
  });

  expect(values.at(-1)).toEqual([false, true, 0.4, 4_000]);
  disposeAutorun();
});

test('rejects incomplete initial state without exposing partial values', () => {
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [new TestTransport()],
  );

  expect(() =>
    connection.handleStateUpdate({
      did: TEST_DIMMABLE_METADATA.device.did,
      online: true,
      properties: [
        {
          did: TEST_DIMMABLE_METADATA.device.did,
          siid: TEST_DIMMABLE_PRIMARY_RESOURCE.service.iid,
          piid: 1,
          value: true,
        },
      ],
    }),
  ).toThrow('Incomplete MIoT endpoint state update.');
  expect(connection.ready).toBe(false);
  expect(connection.on).toBe(false);
  expect(connection.brightness).toBe(0);
  expect(connection.colorTemperature).toBe(2_600);
});

test('normalizes optional light property state', () => {
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [new TestTransport()],
  );
  const values: Array<readonly [number | undefined, number | undefined]> = [];
  const disposeAutorun = autorun(() => {
    values.push([connection.brightness, connection.colorTemperature]);
  });

  connection.handlePropertyUpdate({
    did: TEST_DIMMABLE_METADATA.device.did,
    siid: TEST_DIMMABLE_PRIMARY_RESOURCE.service.iid,
    piid: 2,
    value: 1,
  });
  connection.handlePropertyUpdate({
    did: TEST_DIMMABLE_METADATA.device.did,
    siid: TEST_DIMMABLE_PRIMARY_RESOURCE.service.iid,
    piid: 2,
    value: 50,
  });
  connection.handlePropertyUpdate({
    did: TEST_DIMMABLE_METADATA.device.did,
    siid: TEST_DIMMABLE_PRIMARY_RESOURCE.service.iid,
    piid: 3,
    value: 4_000,
  });

  expect(values).toEqual([
    [0, 2_600],
    [0.01, 2_600],
    [0.5, 2_600],
    [0.5, 4_000],
  ]);
  disposeAutorun();
});

test('normalizes uint16 brightness state against its raw maximum', () => {
  const metadata = createMetadataWithBrightnessRange([1, 65_535, 1]);
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [new TestTransport()],
  );

  connection.handlePropertyUpdate({
    did: metadata.device.did,
    siid: getMiotEndpointConnectionProperty(metadata, 'brightness').service.iid,
    piid: 2,
    value: 1,
  });
  expect(connection.brightness).toBe(1 / 65_535);

  connection.handlePropertyUpdate({
    did: metadata.device.did,
    siid: getMiotEndpointConnectionProperty(metadata, 'brightness').service.iid,
    piid: 2,
    value: 65_535,
  });
  expect(connection.brightness).toBe(1);
});

test('rejects optional property state outside its declared value range', () => {
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [new TestTransport()],
  );

  expect(() =>
    connection.handlePropertyUpdate({
      did: TEST_DIMMABLE_METADATA.device.did,
      siid: TEST_DIMMABLE_PRIMARY_RESOURCE.service.iid,
      piid: 2,
      value: 0,
    }),
  ).toThrow('Invalid MIoT ranged property state.');

  expect(() =>
    connection.handlePropertyUpdate({
      did: TEST_DIMMABLE_METADATA.device.did,
      siid: TEST_DIMMABLE_PRIMARY_RESOURCE.service.iid,
      piid: 2,
      value: 101,
    }),
  ).toThrow(
    'Invalid MIoT ranged property state. brightness=101 at did device-1, siid 2, piid 2; expected 1..100.',
  );
});

test('accepts ranged property state that is not aligned to the command step', () => {
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [new TestTransport()],
  );

  connection.handlePropertyUpdate({
    did: TEST_DIMMABLE_METADATA.device.did,
    siid: TEST_DIMMABLE_PRIMARY_RESOURCE.service.iid,
    piid: 3,
    value: 4_049,
  });

  expect(connection.colorTemperature).toBe(4_049);
});

test('accepts only declared value-list property state', () => {
  const connection = new TestValueListEndpointConnection(
    new MiotProvider('provider'),
    TEST_VALUE_LIST_METADATA,
    [new TestTransport()],
  );
  const update = {
    did: TEST_VALUE_LIST_METADATA.device.did,
    siid: TEST_VALUE_LIST_PRIMARY_RESOURCE.service.iid,
    piid: 3,
  };

  expect(() =>
    connection.handlePropertyUpdate({...update, value: 1}),
  ).not.toThrow();
  expect(() => connection.handlePropertyUpdate({...update, value: 2})).toThrow(
    'Invalid MIoT value-list property state.',
  );
});

function createExpectedSetPropertyRequest(
  piid: number,
  value: unknown,
): MiotSetPropertyRequest {
  return new MiotSetPropertyRequest(
    {
      did: TEST_METADATA.device.did,
      siid: TEST_PRIMARY_RESOURCE.service.iid,
      piid,
    },
    value,
  );
}

function createMetadataWithBrightnessRange(
  valueRange: [number, number, number],
): MiotEndpointConnectionResolvedMetadata {
  const onProperty = TEST_PRIMARY_RESOURCE.properties.on;

  if (onProperty === undefined) {
    throw new Error('Test light metadata has no on property.');
  }

  const brightnessProperty = {
    iid: 2,
    type: 'urn:miot-spec-v2:property:brightness:0000000D',
    description: 'Brightness',
    format: 'uint16',
    access: ['read', 'write', 'notify'],
    unit: 'percentage',
    'value-range': valueRange,
  };

  return createTestResolvedMetadata({
    ...TEST_METADATA,
    resources: [
      {
        service: {
          ...TEST_PRIMARY_RESOURCE.service,
          properties: [onProperty, brightnessProperty],
        },
        properties: {on: onProperty, brightness: brightnessProperty},
      },
    ],
  });
}

function getResource(
  metadata: MiotEndpointConnectionResolvedMetadata,
  index: number,
): MiotEndpointConnectionResolvedResource {
  const resource = metadata.resources[index];

  if (resource === undefined) {
    throw new Error(`Missing test MIoT endpoint resource at index ${index}.`);
  }

  return resource;
}

function createTestResolvedMetadata(
  value: unknown,
): MiotEndpointConnectionResolvedMetadata {
  const metadata = normalizeMiotEndpointConnectionMetadata(value);
  const resources = (value as {resources?: unknown}).resources;

  if (!Array.isArray(resources)) {
    throw new TypeError('Test resolved metadata requires resources.');
  }

  return createMiotEndpointConnectionResolvedMetadata(
    metadata,
    resources as MiotEndpointConnectionResolvedResource[],
  );
}

function createMultiResourceConnection(): TestMultiResourceEndpointConnection {
  return new TestMultiResourceEndpointConnection(
    new MiotProvider('provider'),
    TEST_MULTI_RESOURCE_METADATA,
    [new TestTransport()],
  );
}

class TestTransport extends MiotEndpointConnectionTransport {
  readonly requests: MiotExecutionRequest[] = [];

  override async executeRequest(
    request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult> {
    this.requests.push(request);
    return {code: 0};
  }
}

class TestValueListEndpointConnection extends MiotEndpointConnection<never> {
  override processCommand(_command: never): Promise<void> {
    return Promise.resolve();
  }
}

class TestMultiResourceEndpointConnection extends MiotEndpointConnection<never> {
  get on(): boolean {
    return (this.getState('on') as boolean | undefined) ?? false;
  }

  get temperature(): number {
    return (this.getState('temperature') as number | undefined) ?? 0;
  }

  get humidity(): number {
    return (this.getState('humidity') as number | undefined) ?? 0;
  }

  override processCommand(_command: never): Promise<void> {
    return Promise.resolve();
  }
}
