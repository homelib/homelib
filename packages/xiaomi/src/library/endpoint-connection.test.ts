import {
  type CommandEffect,
  CommandError,
  type CommandExecution,
  DeviceEntry,
  type EndpointConnection,
  EndpointConnectionError,
  Light,
  LightEndpoint,
  type LightEndpointCommand,
  SetLightBrightnessCommand,
  SetLightColorTemperatureCommand,
  SetLightOnCommand,
  Temperature,
} from '@homelib/core';
import {autorun, reaction} from 'mobx';

import {
  CloudDeviceChannel,
  type CloudDeviceMessageSource,
  type CloudMqttDeviceMessageHandler,
} from './cloud/index.js';
import type {MiotPlaceholderCommand} from './command.js';
import {
  MiotLightEndpointConnection,
  encodeMiotPropertyValue,
} from './devices/index.js';
import {
  LegacyMiotEndpointConnectionMetadata,
  MiotEndpointConnection,
  type MiotEndpointConnectionResolvedMetadata,
  type MiotEndpointConnectionResolvedResource,
  MiotEndpointConnectionTransport,
  MiotEndpointConnectionTransportError,
  MiotEndpointConnectionTransportUnavailableError,
  type MiotEndpointStateUpdate,
  createMiotEndpointConnectionResolvedMetadata,
  getMiotEndpointConnectionProperty,
  getMiotEndpointConnectionResourceKeys,
  isLegacyMiotEndpointConnectionMetadata,
  normalizeMiotEndpointConnectionMetadata,
} from './endpoint-connection.js';
import {
  type MiotEventArgument,
  type MiotExecutionRequest,
  type MiotExecutionResult,
  type MiotProperty,
  type MiotPropertySchema,
  MiotSetPropertyRequest,
  type MiotSpecEvent,
  type MiotSpecProperty,
  type MiotSpecValueList,
  type MiotSpecValueRange,
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
        'color-temperature': {
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
const TEST_ENVIRONMENT_RELATIVE_HUMIDITY_PROPERTY = {
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
      TEST_ENVIRONMENT_RELATIVE_HUMIDITY_PROPERTY,
    ],
  },
  properties: {
    temperature: TEST_ENVIRONMENT_TEMPERATURE_PROPERTY,
    relativeHumidity: TEST_ENVIRONMENT_RELATIVE_HUMIDITY_PROPERTY,
  },
};
const TEST_MULTI_RESOURCE_METADATA = createTestResolvedMetadata({
  ...TEST_METADATA,
  resources: [TEST_PRIMARY_RESOURCE, TEST_ENVIRONMENT_RESOURCE],
});

const TEST_EVENT_ARGUMENT_PROPERTY = {
  iid: 2,
  type: 'urn:miot-spec-v2:property:brightness:0000000D',
  description: 'Level',
  format: 'uint8',
  access: ['read', 'notify'],
  'value-range': [0, 100, 1],
} satisfies MiotSpecProperty;
const TEST_EVENT = {
  iid: 1,
  type: 'urn:miot-spec-v2:event:changed:00005FFF:test:1',
  description: 'Changed',
  arguments: [1, 2],
} satisfies MiotSpecEvent;
const TEST_EVENT_METADATA = createTestResolvedMetadata({
  ...TEST_METADATA,
  resources: [
    {
      service: {
        ...TEST_PRIMARY_RESOURCE.service,
        properties: [
          ...(TEST_PRIMARY_RESOURCE.service.properties ?? []),
          TEST_EVENT_ARGUMENT_PROPERTY,
        ],
        events: [TEST_EVENT],
      },
      properties: {
        ...TEST_PRIMARY_RESOURCE.properties,
        level: TEST_EVENT_ARGUMENT_PROPERTY,
      },
      events: {changed: TEST_EVENT},
    },
  ],
});

const _TEST_MULTI_RESOURCE_PROPERTIES = {
  'urn:miot-spec-v2:service:light:00007802': {
    'urn:miot-spec-v2:property:on:00000006': 'on',
  },
  'urn:miot-spec-v2:service:environment:0000780A': {
    'urn:miot-spec-v2:property:temperature:00000020': 'temperature',
    'urn:miot-spec-v2:property:relative-humidity:0000000C': 'relativeHumidity',
  },
} as const satisfies MiotPropertySchema;

const _TEST_HELPER_PROPERTIES = {
  'urn:miot-spec-v2:service:light:00007802': {
    'urn:miot-spec-v2:property:on:00000006': 'on',
  },
  'urn:miot-spec-v2:service:fan:00007808': {
    'urn:miot-spec-v2:property:mode:00000008': {
      name: 'mode',
      optional: true,
    },
    'urn:miot-spec-v2:property:fan-level:00000016': {
      name: 'missingSpeed',
      optional: true,
    },
  },
  'urn:miot-spec-v2:service:environment:0000780A': {
    'urn:miot-spec-v2:property:temperature:00000020': 'temperatureCelsius',
    'urn:miot-spec-v2:property:indoor-temperature:00000021':
      'temperatureFahrenheit',
    'urn:miot-spec-v2:property:outdoor-temperature:00000022':
      'temperatureKelvin',
    'urn:miot-spec-v2:property:relative-humidity:0000000C': 'relativeHumidity',
  },
} as const satisfies MiotPropertySchema;

const TEST_HELPER_MODE_PROPERTY = {
  iid: 3,
  type: 'urn:miot-spec-v2:property:mode:00000008:test-fan:1',
  description: 'Mode',
  format: 'uint8',
  access: ['read', 'write', 'notify'],
  'value-list': [
    {value: 0, description: 'Off'},
    {value: 1, description: 'On'},
    {value: 2, description: 'Vendor Extra'},
  ],
} satisfies MiotSpecProperty;

const TEST_HELPER_TEMPERATURE_PROPERTIES = [
  {
    ...TEST_ENVIRONMENT_TEMPERATURE_PROPERTY,
    type: 'urn:miot-spec-v2:property:temperature:00000020',
    unit: 'celsius',
  },
  {
    ...TEST_ENVIRONMENT_TEMPERATURE_PROPERTY,
    iid: 3,
    type: 'urn:miot-spec-v2:property:indoor-temperature:00000021',
    unit: 'fahrenheit',
  },
  {
    ...TEST_ENVIRONMENT_TEMPERATURE_PROPERTY,
    iid: 4,
    type: 'urn:miot-spec-v2:property:outdoor-temperature:00000022',
    unit: 'kelvin',
    'value-range': [0, 500, 0.1],
  },
] as const satisfies readonly MiotSpecProperty[];

const TEST_HELPER_METADATA = createTestResolvedMetadata({
  ...TEST_METADATA,
  resources: [
    TEST_PRIMARY_RESOURCE,
    {
      service: {
        iid: 4,
        type: 'urn:miot-spec-v2:service:fan:00007808:test-fan:1',
        description: 'Fan',
        properties: [TEST_HELPER_MODE_PROPERTY],
      },
      properties: {
        mode: TEST_HELPER_MODE_PROPERTY,
      },
    },
    {
      service: {
        ...TEST_ENVIRONMENT_RESOURCE.service,
        properties: [
          ...TEST_HELPER_TEMPERATURE_PROPERTIES,
          TEST_ENVIRONMENT_RELATIVE_HUMIDITY_PROPERTY,
        ],
      },
      properties: {
        temperatureCelsius: TEST_HELPER_TEMPERATURE_PROPERTIES[0],
        temperatureFahrenheit: TEST_HELPER_TEMPERATURE_PROPERTIES[1],
        temperatureKelvin: TEST_HELPER_TEMPERATURE_PROPERTIES[2],
        relativeHumidity: TEST_ENVIRONMENT_RELATIVE_HUMIDITY_PROPERTY,
      },
    },
  ],
});

test('provides typed property state helpers across resolved resources', () => {
  const connection = createHelperConnection();
  const initialTemperature = Temperature.fromKelvin(10);

  expect(connection.propertyNames).toEqual({
    on: 'on',
    mode: 'mode',
    temperatureCelsius: 'temperatureCelsius',
  });

  const requiredBoolean: boolean = connection.on;
  const optionalNumber: number | undefined = connection.missingSpeed;
  const optionalMode: number | undefined = connection.mode;
  // @ts-expect-error -- Physical numeric state is not a domain enum.
  const domainMode: 'off' | 'on' | undefined = connection.mode;

  void requiredBoolean;
  void optionalNumber;
  void optionalMode;
  void domainMode;

  expect(connection.on).toBe(false);
  expect(connection.rawOn).toBeUndefined();
  expect(connection.relativeHumidity).toBe(50);
  expect(connection.missingSpeed).toBeUndefined();
  expect(connection.missingSpeedWithInitial).toBeUndefined();
  expect(connection.mode).toBeUndefined();
  expect(connection.projectedMode).toBe(0);
  expect(connection.projectionCount).toBe(0);
  expect(connection.getTemperatureCelsius(initialTemperature)).toBe(
    initialTemperature,
  );

  connection.handlePropertyUpdate({
    did: TEST_METADATA.device.did,
    siid: 2,
    piid: 1,
    value: true,
  });
  connection.handlePropertyUpdate({
    did: TEST_METADATA.device.did,
    siid: 4,
    piid: 3,
    value: 1,
  });
  connection.handlePropertyUpdate({
    did: TEST_METADATA.device.did,
    siid: 3,
    piid: 1,
    value: 20,
  });
  connection.handlePropertyUpdate({
    did: TEST_METADATA.device.did,
    siid: 3,
    piid: 3,
    value: 68,
  });
  connection.handlePropertyUpdate({
    did: TEST_METADATA.device.did,
    siid: 3,
    piid: 4,
    value: 293.15,
  });

  expect(connection.on).toBe(true);
  expect(connection.mode).toBe(1);
  expect(connection.projectedMode).toBe(0.5);
  expect(connection.projectionCount).toBe(1);
  expect(connection.getTemperatureCelsius(initialTemperature).celsius).toBe(20);
  expect(connection.temperatureFahrenheit.celsius).toBeCloseTo(20);
  expect(connection.temperatureKelvin.celsius).toBeCloseTo(20);

  const previousStateRevision = connection.stateRevision;
  const previousModeObservationRevision = connection.getObservationRevision([
    'mode',
  ]);

  connection.handlePropertyUpdate({
    did: TEST_METADATA.device.did,
    siid: 4,
    piid: 3,
    value: 2,
  });

  expect(connection.stateRevision).toBe(previousStateRevision + 1);
  expect(connection.getObservationRevision(['mode'])).toBeGreaterThan(
    previousModeObservationRevision,
  );
  expect(connection.mode).toBe(2);
  expect(connection.projectedMode).toBe(1);
  expect(connection.projectionCount).toBe(2);

  connection.handlePropertyUpdate({
    did: TEST_METADATA.device.did,
    siid: 4,
    piid: 3,
    value: 1,
  });
  expect(connection.mode).toBe(1);
});

test('resolves device-owned codecs from connection metadata once', () => {
  const connection = createHelperConnection();
  const resolvedModeProperty = {...TEST_HELPER_MODE_PROPERTY, name: 'mode'};

  expect(connection.modeCodecDeviceType).toBe(TEST_HELPER_METADATA.device.urn);
  expect(connection.modeCodecProperty).toEqual(resolvedModeProperty);
  expect(connection.codecResolutionCount).toBe(1);

  expect(connection.modeCodecDeviceType).toBe(TEST_HELPER_METADATA.device.urn);
  expect(connection.modeCodecProperty).toEqual(resolvedModeProperty);
  expect(connection.codecResolutionCount).toBe(1);
  expect(connection.missingSpeedCodecAvailable).toBe(false);
  expect(connection.unsupportedModeCodecAvailable).toBe(false);

  connection.handlePropertyUpdate({
    did: TEST_METADATA.device.did,
    siid: 4,
    piid: 3,
    value: 2,
  });

  expect(connection.modeCodecRaw).toBe(2);
  expect(connection.codecResolutionCount).toBe(1);
});

test('validates range, value-list, and temperature metadata in helpers', () => {
  const connection = createHelperConnection();

  expect(connection.relativeHumidityRange).toEqual([0, 100, 1]);
  expect(connection.modeValueList.map(entry => entry.value)).toEqual([0, 1, 2]);
  expect(() => connection.invalidRange).toThrow(
    'Invalid MIoT property value range: on.',
  );
  expect(() => connection.invalidValueList).toThrow(
    'Invalid MIoT property value list: on.',
  );
});

test('normalizes legacy metadata and strips persisted property aliases', () => {
  const serialized = JSON.stringify(TEST_MULTI_RESOURCE_METADATA);
  const metadata = normalizeMiotEndpointConnectionMetadata(
    JSON.parse(serialized) as unknown,
  );

  if (!isLegacyMiotEndpointConnectionMetadata(metadata)) {
    throw new TypeError('Expected legacy test metadata.');
  }

  expect(metadata.resources).toMatchObject([
    {service: {iid: 2}},
    {service: {iid: 3}},
  ]);
  expect(
    metadata.resources.every(
      resource =>
        (resource as {readonly properties?: unknown}).properties === undefined,
    ),
  ).toBe(true);
  expect(
    getMiotEndpointConnectionResourceKeys(TEST_MULTI_RESOURCE_METADATA),
  ).toEqual([
    JSON.stringify([TEST_METADATA.device.did, 2]),
    JSON.stringify([TEST_METADATA.device.did, 3]),
  ]);
});

test('normalizes current identity metadata without legacy resources', () => {
  expect(
    normalizeMiotEndpointConnectionMetadata({
      version: 1,
      device: TEST_METADATA.device,
      resources: [{service: TEST_PRIMARY_RESOURCE.service}],
    }),
  ).toEqual({version: 1, device: TEST_METADATA.device});
});

test('does not treat an unknown metadata version as legacy', () => {
  expect(() =>
    normalizeMiotEndpointConnectionMetadata({
      version: 2,
      device: TEST_METADATA.device,
      resources: [{service: TEST_PRIMARY_RESOURCE.service}],
    }),
  ).toThrow();
});

test('resource keys are canonical regardless of resolved resource order', () => {
  const metadata = createTestResolvedMetadata({
    ...TEST_MULTI_RESOURCE_METADATA,
    resources: TEST_MULTI_RESOURCE_METADATA.resources
      .toReversed()
      .map(resource => ({...resource})),
  });

  expect(getMiotEndpointConnectionResourceKeys(metadata)).toEqual([
    JSON.stringify([TEST_METADATA.device.did, 2]),
    JSON.stringify([TEST_METADATA.device.did, 3]),
  ]);
});

test('rejects metadata without any resources', () => {
  expect(() =>
    LegacyMiotEndpointConnectionMetadata.satisfies({
      ...TEST_METADATA,
      resources: [],
    }),
  ).toThrow('MIoT endpoint metadata requires at least one resource.');
});

test('rejects legacy single-service endpoint metadata', () => {
  expect(() =>
    LegacyMiotEndpointConnectionMetadata.satisfies({
      device: TEST_METADATA.device,
      service: TEST_PRIMARY_RESOURCE.service,
      properties: TEST_PRIMARY_RESOURCE.properties,
    }),
  ).toThrow();
});

test('separates snapshot properties from all notification targets', () => {
  const connection = createMultiResourceConnection();
  const snapshotProperties: readonly MiotProperty[] =
    connection.snapshotProperties;

  expect(snapshotProperties).toEqual([
    {did: TEST_METADATA.device.did, siid: 2, piid: 1},
    {did: TEST_METADATA.device.did, siid: 3, piid: 1},
    {did: TEST_METADATA.device.did, siid: 3, piid: 2},
  ]);
  expect(connection.stateProperties).toEqual(connection.snapshotProperties);
  expect(connection.notificationTargets).toEqual([
    {
      type: 'property-change',
      data: {did: TEST_METADATA.device.did, siid: 2, piid: 1},
    },
    {
      type: 'property-change',
      data: {did: TEST_METADATA.device.did, siid: 3, piid: 1},
    },
    {
      type: 'property-change',
      data: {did: TEST_METADATA.device.did, siid: 3, piid: 2},
    },
  ]);
});

test('selects all participating snapshot properties', () => {
  const connection = createSelectedSnapshotConnection();

  expect(connection.snapshotProperties).toEqual([
    {did: TEST_METADATA.device.did, siid: 2, piid: 1},
    {did: TEST_METADATA.device.did, siid: 3, piid: 1},
  ]);
  expect(connection.replaySnapshotPropertyNotifications).toEqual([
    {did: TEST_METADATA.device.did, siid: 2, piid: 1},
    {did: TEST_METADATA.device.did, siid: 3, piid: 1},
  ]);
});

test('accepts any valid online snapshot subset, including an empty subset', () => {
  const connection = createSelectedSnapshotConnection();

  expect(
    connection.handleStateUpdate({
      did: TEST_METADATA.device.did,
      online: true,
      properties: [],
    }),
  ).toEqual([]);
  expect(connection.ready).toBe(true);

  expect(
    connection.handleStateUpdate({
      did: TEST_METADATA.device.did,
      online: true,
      properties: [
        {did: TEST_METADATA.device.did, siid: 3, piid: 1, value: 24.5},
      ],
    }),
  ).toEqual([]);

  expect(connection.ready).toBe(true);
  expect(connection.getCommandEffectState('on')).toBeUndefined();
  expect(connection.getCommandEffectState('temperature')).toBe(24.5);

  expect(
    connection.handleStateUpdate({
      did: TEST_METADATA.device.did,
      online: true,
      properties: [
        {did: TEST_METADATA.device.did, siid: 2, piid: 1, value: true},
      ],
    }),
  ).toEqual([]);

  expect(connection.ready).toBe(true);
  expect(connection.getCommandEffectState('on')).toBe(true);
  expect(connection.getCommandEffectState('temperature')).toBe(24.5);
});

test('keeps an online endpoint ready when only selected values are omitted', () => {
  const connection = createSelectedSnapshotConnection();

  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [
      {did: TEST_METADATA.device.did, siid: 2, piid: 1, value: true},
    ],
  });

  expect(connection.ready).toBe(true);
  expect(connection.getCommandEffectState('on')).toBe(true);
  expect(connection.getCommandEffectState('temperature')).toBeUndefined();
});

test('invalidates a snapshot property without losing readiness', () => {
  const connection = createSelectedSnapshotConnection();
  const temperature = {
    did: TEST_METADATA.device.did,
    siid: 3,
    piid: 1,
  } as const;

  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [
      {did: TEST_METADATA.device.did, siid: 2, piid: 1, value: true},
      {...temperature, value: 24.5},
    ],
  });
  const revision = connection.stateRevision;

  connection.handleSnapshotInvalidation([temperature]);

  expect(connection.ready).toBe(true);
  expect(connection.stateRevision).toBe(revision + 1);
  expect(connection.observedTemperature).toBe(24.5);
  expect(connection.getCommandEffectState('temperature')).toBeUndefined();
  expect(connection.getObservationRevision(['temperature'])).toBe(revision + 1);
  expect(connection.invalidatedSnapshotProperties).toEqual(['temperature']);
});

test('commits partial snapshot state and invalidation in one observable revision', () => {
  const connection = createSelectedSnapshotConnection();
  const on = {did: TEST_METADATA.device.did, siid: 2, piid: 1} as const;
  const temperature = {
    did: TEST_METADATA.device.did,
    siid: 3,
    piid: 1,
  } as const;

  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [
      {...on, value: true},
      {...temperature, value: 24.5},
    ],
  });

  const revision = connection.stateRevision;
  const values: Array<readonly [boolean | undefined, number | undefined]> = [];
  const disposeReaction = reaction(
    () => [connection.observedOn, connection.observedTemperature] as const,
    value => values.push(value),
    {fireImmediately: true},
  );

  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [{...on, value: false}],
    invalidatedProperties: [temperature],
  });

  expect(values).toEqual([
    [true, 24.5],
    [false, 24.5],
  ]);
  expect(connection.ready).toBe(true);
  expect(connection.stateRevision).toBe(revision + 1);
  expect(connection.getObservationRevision(['on'])).toBe(revision + 1);
  expect(connection.getObservationRevision(['temperature'])).toBe(revision + 1);
  expect(connection.invalidatedSnapshotProperties).toEqual(['temperature']);
  disposeReaction();
});

test('soft-invalidates invalid snapshot values while committing valid siblings', () => {
  const connection = createSelectedSnapshotConnection();
  const on = {did: TEST_METADATA.device.did, siid: 2, piid: 1} as const;
  const temperature = {
    did: TEST_METADATA.device.did,
    siid: 3,
    piid: 1,
  } as const;

  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [
      {...on, value: true},
      {...temperature, value: 24.5},
    ],
  });
  const revision = connection.stateRevision;

  const errors = connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [
      {...on, value: false},
      {...temperature, value: 200},
    ],
  });

  expect(errors).toHaveLength(1);
  expect(errors[0]).toEqual(
    new TypeError(
      'Invalid MIoT ranged property state. temperature=200 at did device-1, siid 3, piid 1; expected -30..100.',
    ),
  );
  expect(connection.ready).toBe(true);
  expect(connection.stateRevision).toBe(revision + 1);
  expect(connection.observedTemperature).toBe(24.5);
  expect(connection.getCommandEffectState('on')).toBe(false);
  expect(connection.getCommandEffectState('temperature')).toBeUndefined();
  expect(connection.getObservationRevision(['on'])).toBe(revision + 1);
  expect(connection.getObservationRevision(['temperature'])).toBe(revision + 1);
  expect(connection.invalidatedSnapshotProperties).toEqual(['temperature']);
});

test('rejects invalid partial snapshot state atomically', () => {
  const connection = createSelectedSnapshotConnection();
  const on = {did: TEST_METADATA.device.did, siid: 2, piid: 1} as const;
  const temperature = {
    did: TEST_METADATA.device.did,
    siid: 3,
    piid: 1,
  } as const;
  const relativeHumidity = {
    did: TEST_METADATA.device.did,
    siid: 3,
    piid: 2,
  } as const;

  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [
      {...on, value: true},
      {...temperature, value: 24.5},
    ],
  });

  const revision = connection.stateRevision;
  const expectUnchanged = (): void => {
    expect(connection.ready).toBe(true);
    expect(connection.stateRevision).toBe(revision);
    expect(connection.getCommandEffectState('on')).toBe(true);
    expect(connection.getCommandEffectState('temperature')).toBe(24.5);
    expect(connection.getObservationRevision(['on'])).toBe(revision);
    expect(connection.getObservationRevision(['temperature'])).toBe(revision);
    expect(connection.invalidatedSnapshotProperties).toEqual([]);
  };

  expect(() =>
    connection.handleStateUpdate({
      did: TEST_METADATA.device.did,
      online: true,
      properties: [{...on, value: false}],
      invalidatedProperties: [relativeHumidity],
    }),
  ).toThrow('Unexpected MIoT endpoint snapshot invalidation property.');
  expectUnchanged();

  expect(() =>
    connection.handleStateUpdate({
      did: TEST_METADATA.device.did,
      online: true,
      properties: [{...on, value: false}],
      invalidatedProperties: [temperature, temperature],
    }),
  ).toThrow('Duplicate MIoT endpoint snapshot invalidation property.');
  expectUnchanged();

  expect(() =>
    connection.handleStateUpdate({
      did: TEST_METADATA.device.did,
      online: true,
      properties: [
        {...on, value: false},
        {...temperature, value: 20},
      ],
      invalidatedProperties: [temperature],
    }),
  ).toThrow('MIoT endpoint state update property is also invalidated.');
  expectUnchanged();

  expect(() =>
    connection.handleStateUpdate({
      did: TEST_METADATA.device.did,
      online: true,
      properties: [{...temperature, value: 'invalid'}],
      invalidatedProperties: [temperature],
    }),
  ).toThrow('MIoT endpoint state update property is also invalidated.');
  expectUnchanged();
});

test('selects resolved events that request snapshot refreshes', () => {
  const defaultConnection = createEventConnection();
  const refreshConnection = new TestSnapshotRefreshEventEndpointConnection(
    new MiotProvider('provider'),
    TEST_EVENT_METADATA,
    [new TestTransport()],
  );

  expect(defaultConnection.snapshotRefreshEvents).toEqual([]);
  expect(refreshConnection.snapshotRefreshEvents).toEqual([
    {
      did: TEST_EVENT_METADATA.device.did,
      siid: TEST_EVENT_METADATA.resources[0]?.service.iid,
      eiid: TEST_EVENT.iid,
    },
  ]);
});

test('can exclude a property from snapshots without dropping its notification', () => {
  const connection = createFilteredSnapshotConnection();

  expect(connection.snapshotProperties).toEqual([
    {did: TEST_METADATA.device.did, siid: 2, piid: 1},
    {did: TEST_METADATA.device.did, siid: 3, piid: 1},
  ]);
  expect(connection.notificationTargets).toContainEqual({
    type: 'property-change',
    data: {did: TEST_METADATA.device.did, siid: 3, piid: 2},
  });

  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [
      {did: TEST_METADATA.device.did, siid: 2, piid: 1, value: true},
      {did: TEST_METADATA.device.did, siid: 3, piid: 1, value: 24.5},
    ],
  });

  expect(connection.ready).toBe(true);
  expect(connection.relativeHumidity).toBe(0);

  connection.handleNotification({
    type: 'property-change',
    data: {did: TEST_METADATA.device.did, siid: 3, piid: 2, value: 55},
  });

  expect(connection.relativeHumidity).toBe(55);
});

test('does not require selected property completeness for online updates', () => {
  const connection = createFilteredSnapshotConnection();

  expect(
    connection.handleStateUpdate({
      did: TEST_METADATA.device.did,
      online: true,
      properties: [
        {did: TEST_METADATA.device.did, siid: 2, piid: 1, value: true},
        {did: TEST_METADATA.device.did, siid: 3, piid: 2, value: 55},
      ],
    }),
  ).toEqual([]);
  expect(connection.ready).toBe(true);
  expect(connection.on).toBe(true);
  expect(connection.temperature).toBe(0);
  expect(connection.relativeHumidity).toBe(55);
});

test('invalidates selected snapshot properties atomically', () => {
  const connection = createFilteredSnapshotConnection();
  const on = {did: TEST_METADATA.device.did, siid: 2, piid: 1} as const;
  const temperature = {
    did: TEST_METADATA.device.did,
    siid: 3,
    piid: 1,
  } as const;
  const relativeHumidity = {
    did: TEST_METADATA.device.did,
    siid: 3,
    piid: 2,
  } as const;

  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [
      {...on, value: true},
      {...temperature, value: 24.5},
    ],
  });
  connection.handleNotification({
    type: 'property-change',
    data: {...relativeHumidity, value: 55},
  });

  const revision = connection.stateRevision;
  const expectUnchanged = (): void => {
    expect(connection.ready).toBe(true);
    expect(connection.stateRevision).toBe(revision);
    expect(connection.getCommandEffectState('on')).toBe(true);
    expect(connection.getCommandEffectState('temperature')).toBe(24.5);
    expect(connection.getCommandEffectState('relativeHumidity')).toBe(55);
  };

  expect(() =>
    connection.handleSnapshotInvalidation([on, {...temperature, piid: 999}]),
  ).toThrow('Unexpected MIoT endpoint snapshot invalidation property.');
  expectUnchanged();

  expect(() => connection.handleSnapshotInvalidation([on, on])).toThrow(
    'Duplicate MIoT endpoint snapshot invalidation property.',
  );
  expectUnchanged();

  expect(() =>
    connection.handleSnapshotInvalidation([relativeHumidity]),
  ).toThrow('Unexpected MIoT endpoint snapshot invalidation property.');
  expectUnchanged();

  connection.handleSnapshotInvalidation([on, temperature]);

  expect(connection.ready).toBe(true);
  expect(connection.stateRevision).toBe(revision + 1);
  expect(connection.getCommandEffectState('on')).toBeUndefined();
  expect(connection.getCommandEffectState('temperature')).toBeUndefined();
  expect(connection.getCommandEffectState('relativeHumidity')).toBe(55);
  expect(connection.getObservationRevision(['on'])).toBe(revision + 1);
  expect(connection.getObservationRevision(['temperature'])).toBe(revision + 1);
  expect(connection.getObservationRevision(['relativeHumidity'])).toBe(
    revision,
  );
});

test('validates and dispatches tagged event notifications once', () => {
  const connection = createEventConnection();

  expect(connection.snapshotProperties).toEqual([
    {did: TEST_METADATA.device.did, siid: 2, piid: 1},
    {did: TEST_METADATA.device.did, siid: 2, piid: 2},
  ]);
  expect(connection.notificationTargets).toEqual([
    {
      type: 'property-change',
      data: {did: TEST_METADATA.device.did, siid: 2, piid: 1},
    },
    {
      type: 'property-change',
      data: {did: TEST_METADATA.device.did, siid: 2, piid: 2},
    },
    {
      type: 'event',
      data: {did: TEST_METADATA.device.did, siid: 2, eiid: 1},
    },
  ]);

  connection.handleNotification({
    type: 'event',
    data: {
      did: TEST_METADATA.device.did,
      siid: 2,
      eiid: 1,
      arguments: {
        type: 'identified',
        data: [
          {piid: 2, value: 42},
          {piid: 1, value: true},
        ],
      },
    },
  });

  expect(connection.stateRevision).toBe(1);
  expect(connection.receivedEvents).toEqual([
    {
      name: 'changed',
      arguments: [
        {piid: 1, value: true},
        {piid: 2, value: 42},
      ],
    },
  ]);
});

test('zips positional event arguments in spec order', () => {
  const connection = createEventConnection();

  connection.handleNotification({
    type: 'event',
    data: {
      did: TEST_METADATA.device.did,
      siid: 2,
      eiid: 1,
      arguments: {type: 'positional', data: [false, 42]},
    },
  });

  expect(connection.stateRevision).toBe(1);
  expect(connection.receivedEvents).toEqual([
    {
      name: 'changed',
      arguments: [
        {piid: 1, value: false},
        {piid: 2, value: 42},
      ],
    },
  ]);
});

test('rejects event arguments with wrong PIIDs or property values atomically', () => {
  const connection = createEventConnection();

  expect(() =>
    connection.handleNotification({
      type: 'event',
      data: {
        did: TEST_METADATA.device.did,
        siid: 2,
        eiid: 1,
        arguments: {
          type: 'identified',
          data: [
            {piid: 1, value: true},
            {piid: 3, value: 42},
          ],
        },
      },
    }),
  ).toThrow('Invalid MIoT endpoint event notification arguments.');
  expect(() =>
    connection.handleNotification({
      type: 'event',
      data: {
        did: TEST_METADATA.device.did,
        siid: 2,
        eiid: 1,
        arguments: {
          type: 'identified',
          data: [
            {piid: 1, value: true},
            {piid: 1, value: false},
          ],
        },
      },
    }),
  ).toThrow('Invalid MIoT endpoint event notification arguments.');
  expect(() =>
    connection.handleNotification({
      type: 'event',
      data: {
        did: TEST_METADATA.device.did,
        siid: 2,
        eiid: 1,
        arguments: {
          type: 'identified',
          data: [
            {piid: 1, value: true},
            {piid: 2, value: 101},
          ],
        },
      },
    }),
  ).toThrow('Invalid MIoT ranged property state.');
  expect(() =>
    connection.handleNotification({
      type: 'event',
      data: {
        did: TEST_METADATA.device.did,
        siid: 2,
        eiid: 1,
        arguments: {type: 'positional', data: [true]},
      },
    }),
  ).toThrow('Invalid MIoT endpoint event notification arguments.');
  expect(connection.receivedEvents).toEqual([]);
  expect(connection.stateRevision).toBe(0);
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
    LegacyMiotEndpointConnectionMetadata.satisfies({
      ...TEST_MULTI_RESOURCE_METADATA,
      resources: [
        {service: TEST_PRIMARY_RESOURCE.service},
        {
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
          properties: [
            writableTemperature,
            TEST_ENVIRONMENT_RELATIVE_HUMIDITY_PROPERTY,
          ],
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
      connection.relativeHumidity,
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

  await executeCommand(connection, new SetLightOnCommand(true));

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

test('falls back when a transport is unavailable before publishing', async () => {
  const unavailableTransport = new TestTransport(() => {
    throw new MiotEndpointConnectionTransportUnavailableError(
      'Local route unavailable.',
    );
  });
  const fallbackTransport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [unavailableTransport, fallbackTransport],
  );

  await executeCommand(connection, new SetLightOnCommand(true));

  expect(unavailableTransport.requests).toHaveLength(1);
  expect(fallbackTransport.requests).toEqual(unavailableTransport.requests);
});

test('does not fall back after an unexpected transport failure', async () => {
  const failedTransport = new TestTransport(() => {
    throw new Error('Connection lost after publishing.');
  });
  const fallbackTransport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [failedTransport, fallbackTransport],
  );

  const command = executeCommand(connection, new SetLightOnCommand(true));

  await expect(command).rejects.toEqual(
    expect.objectContaining({
      name: MiotEndpointConnectionTransportError.name,
      message: 'MIoT transport failed: Connection lost after publishing.',
    }),
  );
  await expect(command).rejects.not.toBeInstanceOf(EndpointConnectionError);
  expect(failedTransport.requests).toHaveLength(1);
  expect(fallbackTransport.requests).toEqual([]);
});

test('does not let Core retry a transport failure after publication may have begun', async () => {
  const failedTransport = new TestTransport(() => {
    throw new Error('Connection lost after publishing.');
  });
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [failedTransport],
  );
  const endpoint = new LightEndpoint();
  endpoint.bindConnection(connection);
  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [createStateProperty(TEST_METADATA, 'on', false)],
  });

  try {
    endpoint.turnOn();
    await wait(150);

    expect(failedTransport.requests).toHaveLength(1);
  } finally {
    endpoint.bindConnection(undefined);
  }
});

test('keeps an uncertain property effect through an unrelated property update', async () => {
  let failNextRequest = false;
  const transport = new TestTransport(() => {
    if (failNextRequest) {
      failNextRequest = false;
      throw new Error('Connection lost after publishing.');
    }

    return {code: 0};
  });
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [transport],
  );
  const endpoint = new LightEndpoint();
  endpoint.bindConnection(connection);
  connection.handleStateUpdate({
    did: TEST_DIMMABLE_METADATA.device.did,
    online: true,
    properties: [
      createStateProperty(TEST_DIMMABLE_METADATA, 'on', true),
      createStateProperty(TEST_DIMMABLE_METADATA, 'brightness', 50),
      createStateProperty(TEST_DIMMABLE_METADATA, 'color-temperature', 4_000),
    ],
  });

  endpoint.turnOff();
  await flushMicrotasks();
  connection.handlePropertyUpdate(
    createStateProperty(TEST_DIMMABLE_METADATA, 'on', false),
  );
  failNextRequest = true;
  endpoint.turnOn();
  await flushMicrotasks();
  connection.handlePropertyUpdate(
    createStateProperty(TEST_DIMMABLE_METADATA, 'brightness', 60),
  );
  endpoint.turnOff();
  await flushMicrotasks();

  expect(transport.requests).toEqual([
    createExpectedSetPropertyRequest(1, false),
    createExpectedSetPropertyRequest(1, true),
    createExpectedSetPropertyRequest(1, false),
  ]);
});

test('treats a transport result as definitive without falling back', async () => {
  const rejectedTransport = new TestTransport(() => ({code: -1}));
  const fallbackTransport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [rejectedTransport, fallbackTransport],
  );

  await expect(
    executeCommand(connection, new SetLightOnCommand(true)),
  ).rejects.toBeInstanceOf(CommandError);
  expect(rejectedTransport.requests).toHaveLength(1);
  expect(fallbackTransport.requests).toEqual([]);
});

test('reports an endpoint connection error when every transport is unavailable', async () => {
  const firstTransport = new TestTransport(() => {
    throw new MiotEndpointConnectionTransportUnavailableError(
      'First route unavailable.',
    );
  });
  const secondTransport = new TestTransport(() => {
    throw new MiotEndpointConnectionTransportUnavailableError(
      'Second route unavailable.',
    );
  });
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [firstTransport, secondTransport],
  );

  await expect(
    executeCommand(connection, new SetLightOnCommand(true)),
  ).rejects.toEqual(
    expect.objectContaining({
      name: EndpointConnectionError.name,
      message: 'MIoT transport failed: Second route unavailable.',
    }),
  );
  expect(firstTransport.requests).toHaveLength(1);
  expect(secondTransport.requests).toHaveLength(1);
});

test('normalizes brightness requests against the raw maximum', async () => {
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [transport],
  );

  await executeCommand(connection, new SetLightBrightnessCommand(0.01));
  await executeCommand(connection, new SetLightBrightnessCommand(0.5));
  await executeCommand(connection, new SetLightBrightnessCommand(1));

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

  await executeCommand(connection, new SetLightBrightnessCommand(1 / 65_535));
  await executeCommand(connection, new SetLightBrightnessCommand(0.5));
  await executeCommand(
    connection,
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

  await executeCommand(
    connection,
    new SetLightBrightnessCommand(Number.NEGATIVE_INFINITY),
  );
  await executeCommand(connection, new SetLightBrightnessCommand(0));
  await executeCommand(connection, new SetLightBrightnessCommand(0.23));
  await executeCommand(connection, new SetLightBrightnessCommand(Infinity));

  expect(transport.requests).toEqual([
    createExpectedSetPropertyRequest(2, 20),
    createExpectedSetPropertyRequest(2, 20),
    createExpectedSetPropertyRequest(2, 25),
    createExpectedSetPropertyRequest(2, 100),
  ]);
});

test('returns a brightness effect using the same device quantization as its request', async () => {
  const metadata = createMetadataWithBrightnessRange([20, 100, 5]);
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [transport],
  );
  const endpoint = new LightEndpoint();
  endpoint.bindConnection(connection);
  connection.handleStateUpdate({
    did: metadata.device.did,
    online: true,
    properties: [
      createStateProperty(metadata, 'on', true),
      createStateProperty(metadata, 'brightness', 23),
    ],
  });

  const effect = requireEffect(
    await executeCommand(connection, new SetLightBrightnessCommand(0.23)),
  );

  expect(transport.requests).toEqual([createExpectedSetPropertyRequest(2, 25)]);
  expect(
    effect.equals(
      requireEffect(
        connection.prepareCommand(new SetLightBrightnessCommand(0.249)).effect,
      ),
    ),
  ).toBe(true);
  expect(
    effect.equals(
      requireEffect(
        connection.prepareCommand(new SetLightBrightnessCommand(0.28)).effect,
      ),
    ),
  ).toBe(false);
  expect(effect.matches(endpoint)).toBe(true);

  connection.handlePropertyUpdate(
    createStateProperty(metadata, 'brightness', 28),
  );
  expect(effect.matches(endpoint)).toBe(false);
});

test('quantizes color temperature requests to the nearest valid step', async () => {
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [transport],
  );

  await executeCommand(connection, new SetLightColorTemperatureCommand(4_049));
  await executeCommand(connection, new SetLightColorTemperatureCommand(4_050));

  expect(transport.requests).toEqual([
    createExpectedSetPropertyRequest(3, 4_000),
    createExpectedSetPropertyRequest(3, 4_100),
  ]);
});

test('returns light on and color temperature effects from public endpoint state', async () => {
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [transport],
  );
  const endpoint = new LightEndpoint();
  endpoint.bindConnection(connection);
  connection.handleStateUpdate({
    did: TEST_DIMMABLE_METADATA.device.did,
    online: true,
    properties: [
      createStateProperty(TEST_DIMMABLE_METADATA, 'on', true),
      createStateProperty(TEST_DIMMABLE_METADATA, 'brightness', 50),
      createStateProperty(TEST_DIMMABLE_METADATA, 'color-temperature', 4_049),
    ],
  });

  const onEffect = requireEffect(
    await executeCommand(connection, new SetLightOnCommand(true)),
  );
  const colorTemperatureEffect = requireEffect(
    await executeCommand(
      connection,
      new SetLightColorTemperatureCommand(4_049),
    ),
  );

  expect(transport.requests).toEqual([
    createExpectedSetPropertyRequest(1, true),
    createExpectedSetPropertyRequest(3, 4_000),
  ]);
  expect(onEffect.matches(endpoint)).toBe(true);
  expect(
    colorTemperatureEffect.equals(
      requireEffect(
        connection.prepareCommand(new SetLightColorTemperatureCommand(4_001))
          .effect,
      ),
    ),
  ).toBe(true);
  expect(
    colorTemperatureEffect.equals(
      requireEffect(
        connection.prepareCommand(new SetLightColorTemperatureCommand(4_050))
          .effect,
      ),
    ),
  ).toBe(false);
  expect(colorTemperatureEffect.matches(endpoint)).toBe(true);

  connection.handlePropertyUpdate(
    createStateProperty(TEST_DIMMABLE_METADATA, 'on', false),
  );
  connection.handlePropertyUpdate(
    createStateProperty(TEST_DIMMABLE_METADATA, 'color-temperature', 4_051),
  );
  expect(onEffect.matches(endpoint)).toBe(false);
  expect(colorTemperatureEffect.matches(endpoint)).toBe(false);
});

test('skips the initial command when observed state already satisfies its effect', async () => {
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [transport],
  );
  const endpoint = new LightEndpoint();
  endpoint.bindConnection(connection);
  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [createStateProperty(TEST_METADATA, 'on', true)],
  });

  endpoint.turnOn();
  await flushMicrotasks();
  endpoint.turnOn();
  await flushMicrotasks();

  expect(transport.requests).toEqual([]);
});

test('skips an initially equivalent quantized property command', async () => {
  const metadata = createMetadataWithBrightnessRange([20, 100, 5]);
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [transport],
  );
  const endpoint = new LightEndpoint();
  endpoint.bindConnection(connection);
  connection.handleStateUpdate({
    did: metadata.device.did,
    online: true,
    properties: [
      createStateProperty(metadata, 'on', true),
      createStateProperty(metadata, 'brightness', 23),
    ],
  });

  endpoint.setBrightness(0.249);
  await flushMicrotasks();

  expect(transport.requests).toEqual([]);
});

test('skips an acknowledged command until a newer state update contradicts its effect', async () => {
  const transport = new TestTransport();
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [transport],
  );
  const endpoint = new LightEndpoint();
  endpoint.bindConnection(connection);
  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [createStateProperty(TEST_METADATA, 'on', false)],
  });

  endpoint.turnOn();
  await flushMicrotasks();
  endpoint.turnOn();
  await flushMicrotasks();

  expect(transport.requests).toEqual([
    createExpectedSetPropertyRequest(1, true),
  ]);

  connection.handlePropertyUpdate(
    createStateProperty(TEST_METADATA, 'on', false),
  );
  endpoint.turnOn();
  await flushMicrotasks();

  expect(transport.requests).toEqual([
    createExpectedSetPropertyRequest(1, true),
    createExpectedSetPropertyRequest(1, true),
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
    executeCommand(unsupportedConnection, new SetLightBrightnessCommand(0.5)),
  ).rejects.toThrow('MIoT light does not support brightness.');
  await expect(
    executeCommand(
      unsupportedConnection,
      new SetLightColorTemperatureCommand(4_000),
    ),
  ).rejects.toThrow('MIoT light does not support color temperature.');
  await executeCommand(
    dimmableConnection,
    new SetLightColorTemperatureCommand(Number.NEGATIVE_INFINITY),
  );
  await executeCommand(
    dimmableConnection,
    new SetLightColorTemperatureCommand(0),
  );
  await executeCommand(
    dimmableConnection,
    new SetLightColorTemperatureCommand(2_599),
  );
  await executeCommand(
    dimmableConnection,
    new SetLightColorTemperatureCommand(Infinity),
  );

  expect(unsupportedTransport.requests).toEqual([]);
  expect(dimmableTransport.requests).toEqual([
    createExpectedSetPropertyRequest(3, 2_600),
    createExpectedSetPropertyRequest(3, 2_600),
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
  const subscription = await channel.subscribe(
    {
      snapshotProperties: connection.snapshotProperties,
      notifications: connection.notificationTargets,
    },
    {
      onStateChanged: state => {
        connection.handleStateUpdate(state);
      },
      onNotification: notification => {
        connection.handleNotification(notification);
      },
    },
  );

  const handler = messageHandler;

  if (handler === undefined) {
    throw new Error('Cloud MQTT handler was not registered.');
  }

  const [property] = connection.snapshotProperties;

  if (property === undefined) {
    throw new Error('MIoT light state property is missing.');
  }

  handler({
    type: 'property-change',
    data: {...property, value: true},
  });

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
    [false, false, undefined, undefined],
    [true, true, 0.4, 4_000],
  ]);

  connection.handleSnapshotInvalidation([
    {
      did: TEST_DIMMABLE_METADATA.device.did,
      siid: TEST_DIMMABLE_PRIMARY_RESOURCE.service.iid,
      piid: 2,
    },
  ]);

  expect(connection.brightness).toBe(0.4);
  expect(connection.getCommandEffectState('brightness')).toBeUndefined();
  expect(values).toEqual([
    [false, false, undefined, undefined],
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

test('revises MIoT state once after each property, snapshot, or offline update', () => {
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_METADATA,
    [new TestTransport()],
  );
  const values: Array<readonly [number, boolean, boolean]> = [];
  const disposeAutorun = autorun(() => {
    values.push([connection.stateRevision, connection.ready, connection.on]);
  });

  connection.handlePropertyUpdate(
    createStateProperty(TEST_METADATA, 'on', true),
  );
  connection.handlePropertyUpdate(
    createStateProperty(TEST_METADATA, 'on', true),
  );
  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: true,
    properties: [createStateProperty(TEST_METADATA, 'on', false)],
  });
  connection.handleStateUpdate({
    did: TEST_METADATA.device.did,
    online: false,
    properties: [],
  });

  expect(values).toEqual([
    [0, false, false],
    [1, false, true],
    [2, false, true],
    [3, true, false],
    [4, false, false],
  ]);
  disposeAutorun();
});

test('tracks observation revisions independently for each property alias', () => {
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [new TestTransport()],
  );

  expect(connection.getObservationRevision(['on'])).toBe(0);
  expect(connection.getObservationRevision(['brightness'])).toBe(0);

  connection.handlePropertyUpdate(
    createStateProperty(TEST_DIMMABLE_METADATA, 'on', true),
  );
  expect(connection.getObservationRevision(['on'])).toBe(1);
  expect(connection.getObservationRevision(['brightness'])).toBe(0);

  connection.handlePropertyUpdate(
    createStateProperty(TEST_DIMMABLE_METADATA, 'on', true),
  );
  expect(connection.getObservationRevision(['on'])).toBe(2);

  connection.handlePropertyUpdate(
    createStateProperty(TEST_DIMMABLE_METADATA, 'brightness', 50),
  );
  expect(connection.getObservationRevision(['on'])).toBe(2);
  expect(connection.getObservationRevision(['brightness'])).toBe(3);
  expect(connection.getObservationRevision(['on', 'brightness'])).toBe(3);

  connection.handleStateUpdate({
    did: TEST_DIMMABLE_METADATA.device.did,
    online: true,
    properties: [
      createStateProperty(TEST_DIMMABLE_METADATA, 'on', false),
      createStateProperty(TEST_DIMMABLE_METADATA, 'brightness', 60),
      createStateProperty(TEST_DIMMABLE_METADATA, 'color-temperature', 4_100),
    ],
  });
  expect(connection.getObservationRevision(['on'])).toBe(4);
  expect(connection.getObservationRevision(['brightness'])).toBe(4);
  expect(connection.getObservationRevision(['color-temperature'])).toBe(4);

  connection.handleStateUpdate({
    did: TEST_DIMMABLE_METADATA.device.did,
    online: false,
    properties: [],
  });
  expect(connection.stateRevision).toBe(5);
  expect(connection.getObservationRevision(['on', 'brightness'])).toBe(5);
  expect(connection.getCommandEffectState('on')).toBeUndefined();
  expect(connection.getCommandEffectState('brightness')).toBeUndefined();
});

test('accepts an initial light state missing other snapshot values', () => {
  const connection = new MiotLightEndpointConnection(
    new MiotProvider('provider'),
    TEST_DIMMABLE_METADATA,
    [new TestTransport()],
  );

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
  });

  expect(connection.ready).toBe(true);
  expect(connection.on).toBe(true);
  expect(connection.brightness).toBeUndefined();
  expect(connection.colorTemperature).toBeUndefined();
  expect(connection.getObservationRevision(['on'])).toBe(1);
  expect(
    connection.getObservationRevision(['brightness', 'color-temperature']),
  ).toBe(0);
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
    [undefined, undefined],
    [0.01, undefined],
    [0.5, undefined],
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

test('enforces numeric format bounds without a value list or range', () => {
  const property = {
    iid: 3,
    type: 'urn:miot-spec-v2:property:mode:00000008:test-fan:1',
    description: 'Mode',
    format: 'uint8',
    access: ['read', 'notify'],
  } satisfies MiotSpecProperty;
  const metadata = createTestResolvedMetadata({
    device: TEST_VALUE_LIST_METADATA.device,
    resources: [
      {
        service: {
          ...TEST_VALUE_LIST_PRIMARY_RESOURCE.service,
          properties: [property],
        },
        properties: {mode: property},
      },
    ],
  });
  const connection = new TestValueListEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [new TestTransport()],
  );
  const createState = (value: number): MiotEndpointStateUpdate => ({
    did: metadata.device.did,
    online: true,
    properties: [createStateProperty(metadata, 'mode', value)],
  });

  expect(connection.handleStateUpdate(createState(255))).toEqual([]);
  expect(connection.ready).toBe(true);

  for (const value of [-1, 256]) {
    expect(connection.handleStateUpdate(createState(value))).toEqual([
      expect.objectContaining({
        message: 'MIoT property state exceeds its format range.',
      }),
    ]);
    expect(connection.ready).toBe(true);
  }
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

function createStateProperty(
  metadata: MiotEndpointConnectionResolvedMetadata,
  name: string,
  value: unknown,
): {
  readonly did: string;
  readonly siid: number;
  readonly piid: number;
  readonly value: unknown;
} {
  const {service, property} = getMiotEndpointConnectionProperty(metadata, name);

  return {
    did: metadata.device.did,
    siid: service.iid,
    piid: property.iid,
    value,
  };
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

function createFilteredSnapshotConnection(): TestFilteredSnapshotEndpointConnection {
  return new TestFilteredSnapshotEndpointConnection(
    new MiotProvider('provider'),
    TEST_MULTI_RESOURCE_METADATA,
    [new TestTransport()],
  );
}

function createSelectedSnapshotConnection(): TestSelectedSnapshotEndpointConnection {
  return new TestSelectedSnapshotEndpointConnection(
    new MiotProvider('provider'),
    TEST_MULTI_RESOURCE_METADATA,
    [new TestTransport()],
  );
}

function createEventConnection(): TestEventEndpointConnection {
  return new TestEventEndpointConnection(
    new MiotProvider('provider'),
    TEST_EVENT_METADATA,
    [new TestTransport()],
  );
}

function createHelperConnection(): TestPropertyHelperEndpointConnection {
  return new TestPropertyHelperEndpointConnection(
    new MiotProvider('provider'),
    TEST_HELPER_METADATA,
    [new TestTransport()],
  );
}

class TestTransport extends MiotEndpointConnectionTransport {
  readonly requests: MiotExecutionRequest[] = [];

  constructor(
    private readonly executor: (
      request: MiotExecutionRequest,
    ) => MiotExecutionResult | Promise<MiotExecutionResult> = () => ({code: 0}),
  ) {
    super();
  }

  override async executeRequest(
    request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult> {
    this.requests.push(request);
    return this.executor(request);
  }
}

class TestValueListEndpointConnection extends MiotEndpointConnection<never> {
  override prepareCommand(_command: never): CommandExecution {
    return {execute: () => Promise.resolve()};
  }
}

class TestPropertyHelperEndpointConnection extends MiotEndpointConnection<
  never,
  typeof _TEST_HELPER_PROPERTIES
> {
  private codecResolutionCountValue = 0;

  private readonly modeCodecDefinition = {
    resolve: (context: {
      readonly deviceType: string;
      readonly property: MiotSpecProperty;
    }) => {
      this.codecResolutionCountValue++;
      return {
        decode: (raw: unknown) => ({...context, raw}),
        encode: (value: {
          readonly deviceType: string;
          readonly property: MiotSpecProperty;
          readonly raw: unknown;
        }) => encodeMiotPropertyValue(context.property, Number(value.raw)),
      };
    },
  };

  private readonly missingSpeedCodecDefinition = {
    resolve: () => {
      throw new Error('An absent property must not resolve its codec.');
    },
  };

  private readonly unsupportedModeCodecDefinition = {
    resolve: () => undefined,
  };

  projectionCount = 0;

  get codecResolutionCount(): number {
    return this.codecResolutionCountValue;
  }

  get modeCodecDeviceType(): string | undefined {
    return this.getPropertyValueCodec('mode', this.modeCodecDefinition)?.read()
      ?.deviceType;
  }

  get modeCodecProperty(): MiotSpecProperty | undefined {
    return this.getPropertyValueCodec('mode', this.modeCodecDefinition)?.read()
      ?.property;
  }

  get modeCodecRaw(): unknown {
    return this.getPropertyValueCodec('mode', this.modeCodecDefinition)?.read()
      ?.raw;
  }

  get missingSpeedCodecAvailable(): boolean {
    return (
      this.getPropertyValueCodec(
        'missingSpeed',
        this.missingSpeedCodecDefinition,
      ) !== undefined
    );
  }

  get unsupportedModeCodecAvailable(): boolean {
    return (
      this.getPropertyValueCodec(
        'mode',
        this.unsupportedModeCodecDefinition,
      ) !== undefined
    );
  }

  get invalidPropertyCodec(): unknown {
    return this.getPropertyValueCodec(
      // @ts-expect-error -- Codec aliases are schema-constrained.
      'missing-mode',
      this.modeCodecDefinition,
    );
  }

  get invalidEncodedPropertyCodec(): unknown {
    return this.getPropertyValueCodec('mode', {
      resolve: () => ({
        decode: () => undefined,
        // @ts-expect-error -- A codec must return encoded physical values.
        encode: () => 0,
      }),
    });
  }

  get propertyNames(): Readonly<Record<string, string | undefined>> {
    return {
      on: this.properties.on.name,
      mode: this.properties.mode?.name,
      temperatureCelsius: this.properties.temperatureCelsius.name,
    };
  }

  get on(): boolean {
    return this.getBooleanPropertyState('on', false);
  }

  get rawOn(): boolean | undefined {
    return this.getBooleanPropertyState('on');
  }

  get incorrectlyRequiredRawOn(): boolean {
    // @ts-expect-error -- A required property can still be unobserved.
    return this.getBooleanPropertyState('on');
  }

  get relativeHumidity(): number {
    return this.getNumberPropertyState('relativeHumidity', 50);
  }

  get missingSpeed(): number | undefined {
    return this.getNumberPropertyState('missingSpeed');
  }

  get missingSpeedWithInitial(): number | undefined {
    return this.getNumberPropertyState('missingSpeed', 3);
  }

  get incorrectlyRequiredMissingSpeed(): number {
    // @ts-expect-error -- An unmatched optional alias remains undefined.
    return this.getNumberPropertyState('missingSpeed', 3);
  }

  get mode(): number | undefined {
    return this.getNumberPropertyState('mode');
  }

  get invalidAlias(): boolean {
    // @ts-expect-error -- Property state aliases are schema-constrained.
    return this.getBooleanPropertyState('onn', false);
  }

  get projectedMode(): number {
    const value = this.getNumberPropertyState('mode');

    if (value === undefined) {
      return 0;
    }

    this.projectionCount++;
    return value / 2;
  }

  getTemperatureCelsius(initial: Temperature): Temperature {
    return this.getTemperaturePropertyState('temperatureCelsius', initial);
  }

  get temperatureFahrenheit(): Temperature {
    return this.getTemperaturePropertyState(
      'temperatureFahrenheit',
      Temperature.fromKelvin(0),
    );
  }

  get temperatureKelvin(): Temperature {
    return this.getTemperaturePropertyState(
      'temperatureKelvin',
      Temperature.fromKelvin(0),
    );
  }

  get relativeHumidityRange(): MiotSpecValueRange {
    return this.getPropertyValueRange(this.properties.relativeHumidity);
  }

  get modeValueList(): MiotSpecValueList {
    const {mode} = this.properties;

    if (mode === undefined) {
      throw new Error('Missing test mode property.');
    }

    return this.getPropertyValueList(mode);
  }

  get invalidRange(): MiotSpecValueRange {
    return this.getPropertyValueRange(this.properties.on);
  }

  get invalidValueList(): MiotSpecValueList {
    return this.getPropertyValueList(this.properties.on);
  }

  override prepareCommand(_command: never): CommandExecution {
    return {execute: () => Promise.resolve()};
  }
}

class TestMultiResourceEndpointConnection extends MiotEndpointConnection<
  never,
  typeof _TEST_MULTI_RESOURCE_PROPERTIES
> {
  get on(): boolean {
    return this.getBooleanPropertyState('on', false);
  }

  get temperature(): number {
    return this.getNumberPropertyState('temperature', 0);
  }

  get relativeHumidity(): number {
    return this.getNumberPropertyState('relativeHumidity', 0);
  }

  override prepareCommand(_command: never): CommandExecution {
    return {execute: () => Promise.resolve()};
  }
}

class TestFilteredSnapshotEndpointConnection extends TestMultiResourceEndpointConnection {
  protected override isSnapshotProperty(name: string): boolean {
    return name !== 'relativeHumidity';
  }
}

class TestSelectedSnapshotEndpointConnection extends TestMultiResourceEndpointConnection {
  readonly invalidatedSnapshotProperties: string[] = [];

  get observedOn(): boolean | undefined {
    return this.getBooleanPropertyState('on');
  }

  get observedTemperature(): number | undefined {
    return this.getNumberPropertyState('temperature');
  }

  protected override isSnapshotProperty(name: string): boolean {
    return name !== 'relativeHumidity';
  }

  protected override shouldReplaySnapshotPropertyNotifications(): boolean {
    return true;
  }

  protected override handleSnapshotPropertyInvalidated(name: string): void {
    this.invalidatedSnapshotProperties.push(name);
  }
}

class TestEventEndpointConnection extends MiotEndpointConnection<never> {
  readonly receivedEvents: Array<{
    readonly name: string;
    readonly arguments: readonly MiotEventArgument[];
  }> = [];

  protected override handleEvent(
    name: string,
    _event: MiotSpecEvent,
    arguments_: readonly MiotEventArgument[],
  ): void {
    this.receivedEvents.push({name, arguments: arguments_});
  }

  override prepareCommand(_command: never): CommandExecution {
    return {execute: () => Promise.resolve()};
  }
}

class TestSnapshotRefreshEventEndpointConnection extends TestEventEndpointConnection {
  protected override shouldRefreshSnapshotOnEvent(
    name: string,
    _event: MiotSpecEvent,
  ): boolean {
    return name === 'changed';
  }
}

async function executeCommand(
  connection: EndpointConnection<LightEndpointCommand>,
  command: LightEndpointCommand,
): Promise<CommandEffect | undefined> {
  const execution = connection.prepareCommand(command);
  await execution.execute();
  return execution.effect;
}

function requireEffect(effect: CommandEffect | undefined): CommandEffect {
  if (effect === undefined) {
    throw new Error('MIoT stateful command returned no effect.');
  }

  return effect;
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}

function wait(delay: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delay));
}
