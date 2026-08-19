import {
  BathHeater,
  BathHeaterEndpoint,
  DeviceEntry,
  SetBathHeaterBlowingCommand,
  SetBathHeaterHeatingCommand,
  SetBathHeaterModeCommand,
  SetBathHeaterTargetTemperatureCommand,
  SetBathHeaterVentilatingCommand,
  StopBathHeaterCommand,
  Temperature,
} from '@homelib/core';

import {
  MiotDeviceRegistry,
  createMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionResources,
} from '../device.js';
import {
  MiotEndpointConnectionTransport,
  getMiotEndpointConnectionProperty,
} from '../endpoint-connection.js';
import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  MiotInvokeActionRequest,
  MiotSetPropertyRequest,
  type MiotSpecInstance,
  type MiotSpecProperty,
  type MiotSpecService,
} from '../miot/index.js';
import {MiotProvider} from '../provider.js';

import {MiotBathHeaterEndpointConnection} from './bath-heater.js';
import {MiotLightEndpointConnection} from './light.js';

test('matches the verified bathroom heater and its separate light service', () => {
  const spec = createSpec();
  const entry = new DeviceEntry('bath heater');
  entry.createInstance(BathHeater);
  const registry = new MiotDeviceRegistry();

  registry.register(
    BathHeater,
    MiotBathHeaterEndpointConnection,
    MiotLightEndpointConnection,
  );

  const match = registry.match(
    {
      deviceConstructors: [BathHeater],
      endpoints: [...entry.endpoints].map(endpoint => ({endpoint})),
    },
    spec,
  );

  expect(MiotBathHeaterEndpointConnection.Endpoint).toBe(BathHeaterEndpoint);
  expect(
    match?.endpoints.map(({endpoint, resources}) => ({
      endpoint: endpoint.endpoint.name,
      services: resources.map(({service}) => service.iid),
    })),
  ).toEqual([
    {endpoint: '', services: [3]},
    {endpoint: 'light', services: [2]},
  ]);
});

test.each([
  [
    'wrong device type',
    (spec: MiotSpecInstance) => {
      spec.type =
        'urn:miot-spec-v2:device:bath-heater:0000A028:unverified-model:1';
    },
  ],
  [
    'wrong mode IID',
    (spec: MiotSpecInstance) => {
      requireProperty(spec, 3, 1).iid = 8;
    },
  ],
  [
    'missing property',
    (spec: MiotSpecInstance) => {
      const service = requireService(spec, 3);
      service.properties = service.properties?.filter(
        property => property.iid !== 4,
      );
    },
  ],
  [
    'missing stop action',
    (spec: MiotSpecInstance) => {
      requireService(spec, 3).actions = [];
    },
  ],
  [
    'duplicate service',
    (spec: MiotSpecInstance) => {
      spec.services.push({...requireService(spec, 3), iid: 4});
    },
  ],
] as const)('fails closed for %s', (_scenario, mutate) => {
  const spec = createSpec();
  mutate(spec);

  expect(
    resolveMiotEndpointConnectionResources(
      MiotBathHeaterEndpointConnection,
      spec,
    ),
  ).toBeUndefined();
});

test('projects observed bathroom heater state without inventing an overall power state', () => {
  const connection = createConnection().connection;

  expect(connection.mode).toBeUndefined();
  expect(connection.heating).toBe(false);
  expect(connection.blowing).toBe(false);
  expect(connection.ventilating).toBe(false);
  expect(connection.targetTemperature).toBeUndefined();
  expect(connection.temperature).toBeUndefined();

  expect(
    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [
        createPropertyUpdate(connection, 'mode', 6),
        createPropertyUpdate(connection, 'heating', false),
        createPropertyUpdate(connection, 'blowing', false),
        createPropertyUpdate(connection, 'ventilating', true),
        createPropertyUpdate(connection, 'target-temperature', 30),
        createPropertyUpdate(connection, 'temperature', 26),
      ],
    }),
  ).toEqual([]);

  expect(connection.ready).toBe(true);
  expect(connection.mode).toBeUndefined();
  expect(connection.heating).toBe(false);
  expect(connection.blowing).toBe(false);
  expect(connection.ventilating).toBe(true);
  expect(connection.targetTemperature?.celsius).toBe(30);
  expect(connection.temperature?.celsius).toBe(26);
});

test.each([
  [1, 'dry'],
  [2, 'defog'],
  [3, 'quick-defog'],
  [4, 'quick-heat'],
  [5, undefined],
  [6, undefined],
] as const)('decodes bathroom heater mode %p as %p', (raw, expected) => {
  const {connection} = createConnection();

  expect(
    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [createPropertyUpdate(connection, 'mode', raw)],
    }),
  ).toEqual([]);
  expect(connection.mode).toBe(expected);
});

test('invalidates a mode outside the physical value list without losing readiness', () => {
  const {connection} = createConnection();

  const errors = connection.handleStateUpdate({
    did: connection.metadata.device.did,
    online: true,
    properties: [createPropertyUpdate(connection, 'mode', 7)],
  });

  expect(errors).toHaveLength(1);
  expect(connection.ready).toBe(true);
  expect(connection.mode).toBeUndefined();
});

test('encodes property commands using the verified physical properties', async () => {
  const {connection, transport} = createConnection();
  const commands = [
    new SetBathHeaterModeCommand('quick-defog'),
    new SetBathHeaterHeatingCommand(true),
    new SetBathHeaterBlowingCommand(true),
    new SetBathHeaterVentilatingCommand(false),
    new SetBathHeaterTargetTemperatureCommand(Temperature.fromCelsius(31.6)),
  ];

  expect(connection.prepareCommand(commands[0]).toLogString?.()).toBe(
    'set mode=3 (quick-defog)',
  );

  for (const command of commands) {
    await connection.prepareCommand(command).execute();
  }

  expect(transport.requests).toEqual([
    new MiotSetPropertyRequest(
      {did: connection.metadata.device.did, siid: 3, piid: 1},
      3,
    ),
    new MiotSetPropertyRequest(
      {did: connection.metadata.device.did, siid: 3, piid: 2},
      true,
    ),
    new MiotSetPropertyRequest(
      {did: connection.metadata.device.did, siid: 3, piid: 3},
      true,
    ),
    new MiotSetPropertyRequest(
      {did: connection.metadata.device.did, siid: 3, piid: 4},
      false,
    ),
    new MiotSetPropertyRequest(
      {did: connection.metadata.device.did, siid: 3, piid: 5},
      32,
    ),
  ]);
});

test('clamps target temperature to the physical range', async () => {
  const {connection, transport} = createConnection();

  await connection
    .prepareCommand(
      new SetBathHeaterTargetTemperatureCommand(Temperature.fromCelsius(10)),
    )
    .execute();
  await connection
    .prepareCommand(
      new SetBathHeaterTargetTemperatureCommand(Temperature.fromCelsius(50)),
    )
    .execute();

  expect(
    transport.requests.map(request => {
      if (!(request instanceof MiotSetPropertyRequest)) {
        throw new TypeError('Expected a target-temperature property request.');
      }

      return request.value;
    }),
  ).toEqual([25, 45]);
});

test('invokes every stop command as a one-shot action', async () => {
  const {connection, transport} = createConnection();
  const first = connection.prepareCommand(new StopBathHeaterCommand());
  const second = connection.prepareCommand(new StopBathHeaterCommand());

  expect(first.effect).toBeUndefined();
  expect(first.toLogString?.()).toBe('stop');
  await first.execute();
  await second.execute();

  expect(transport.requests).toEqual([
    new MiotInvokeActionRequest(
      {did: connection.metadata.device.did, siid: 3, aiid: 1},
      [],
    ),
    new MiotInvokeActionRequest(
      {did: connection.metadata.device.did, siid: 3, aiid: 1},
      [],
    ),
  ]);
});

function createConnection(): {
  readonly connection: MiotBathHeaterEndpointConnection;
  readonly transport: TestTransport;
} {
  const spec = createSpec();
  const metadata = resolveMiotEndpointConnectionMetadata(
    MiotBathHeaterEndpointConnection,
    createMiotEndpointConnectionMetadata(
      {did: 'bath-heater-1', model: 'yeelink.bhf_light.v5'},
      spec,
    ),
    spec,
  );
  const transport = new TestTransport();

  return {
    connection: new MiotBathHeaterEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    ),
    transport,
  };
}

function createPropertyUpdate(
  connection: MiotBathHeaterEndpointConnection,
  name: string,
  value: unknown,
): {
  readonly did: string;
  readonly siid: number;
  readonly piid: number;
  readonly value: unknown;
} {
  const {service, property} = getMiotEndpointConnectionProperty(
    connection.metadata,
    name,
  );

  return {
    did: connection.metadata.device.did,
    siid: service.iid,
    piid: property.iid,
    value,
  };
}

function createSpec(): MiotSpecInstance {
  return {
    type: 'urn:miot-spec-v2:device:bath-heater:0000A028:yeelink-v5:1',
    description: 'Bath Heater',
    services: [createLightService(), createBathHeaterService()],
  };
}

function createLightService(): MiotSpecService {
  return {
    iid: 2,
    type: 'urn:miot-spec-v2:service:light:00007802:yeelink-v5:1',
    description: 'Light Bath Heater',
    properties: [
      createProperty(
        1,
        'urn:miot-spec-v2:property:on:00000006:yeelink-v5:1',
        'bool',
      ),
      {
        ...createProperty(
          2,
          'urn:miot-spec-v2:property:mode:00000008:yeelink-v5:1',
          'uint8',
        ),
        access: ['write'],
        'value-list': [
          {value: 1, description: 'Lighting'},
          {value: 2, description: 'Night Light'},
        ],
      },
      {
        ...createProperty(
          3,
          'urn:miot-spec-v2:property:brightness:0000000D:yeelink-v5:1',
          'uint8',
        ),
        unit: 'percentage',
        'value-range': [1, 100, 1],
      },
    ],
  };
}

function createBathHeaterService(): MiotSpecService {
  return {
    iid: 3,
    type: 'urn:miot-spec-v2:service:ptc-bath-heater:0000783B:yeelink-v5:1',
    description: 'PTC Bath Heater',
    properties: [
      {
        ...createProperty(
          1,
          'urn:miot-spec-v2:property:mode:00000008:yeelink-v5:1',
          'uint8',
        ),
        'value-list': [
          {value: 1, description: 'Dry'},
          {value: 2, description: 'Defog'},
          {value: 3, description: 'Quick Defog'},
          {value: 4, description: 'Quick Heat'},
          {value: 5, description: 'Idle'},
          {value: 6, description: 'None'},
        ],
      },
      createProperty(
        2,
        'urn:miot-spec-v2:property:heating:000000C7:yeelink-v5:1',
        'bool',
      ),
      createProperty(
        3,
        'urn:miot-spec-v2:property:blow:000000CD:yeelink-v5:1',
        'bool',
      ),
      createProperty(
        4,
        'urn:miot-spec-v2:property:ventilation:000000CE:yeelink-v5:1',
        'bool',
      ),
      {
        ...createProperty(
          5,
          'urn:miot-spec-v2:property:target-temperature:00000021:yeelink-v5:1',
          'uint8',
        ),
        unit: 'celsius',
        'value-range': [25, 45, 1],
      },
      {
        ...createProperty(
          6,
          'urn:miot-spec-v2:property:temperature:00000020:yeelink-v5:1',
          'uint8',
        ),
        access: ['read'],
        unit: 'celsius',
        'value-range': [0, 50, 1],
      },
    ],
    actions: [
      {
        iid: 1,
        type: 'urn:miot-spec-v2:action:stop-working:00002825:yeelink-v5:1',
        description: 'Stop Working',
        in: [],
        out: [],
      },
    ],
  };
}

function createProperty(
  iid: number,
  type: string,
  format: string,
): MiotSpecProperty {
  return {
    iid,
    type,
    description: type,
    format,
    access: ['read', 'write', 'notify'],
  };
}

function requireService(spec: MiotSpecInstance, iid: number): MiotSpecService {
  const service = spec.services.find(candidate => candidate.iid === iid);

  if (service === undefined) {
    throw new Error(`Missing test service: ${iid}.`);
  }

  return service;
}

function requireProperty(
  spec: MiotSpecInstance,
  siid: number,
  piid: number,
): MiotSpecProperty {
  const property = requireService(spec, siid).properties?.find(
    candidate => candidate.iid === piid,
  );

  if (property === undefined) {
    throw new Error(`Missing test property: ${siid}.${piid}.`);
  }

  return property;
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
