import {
  CommandError,
  DispensePetFoodCommand,
  PetFeederEndpoint,
} from '@homelib/core';

import {
  createMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionResources,
} from '../../device.js';
import {MiotPetFeederEndpointConnection} from '../../devices/pet-feeder.js';
import {
  MiotEndpointConnectionTransport,
  getMiotEndpointConnectionProperty,
} from '../../endpoint-connection/index.js';
import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  MiotInvokeActionRequest,
  type MiotSpecInstance,
  type MiotSpecProperty,
  type MiotSpecService,
} from '../../miot/index.js';
import {MiotProvider} from '../../provider.js';

const VERIFIED_FEEDERS = [
  {
    deviceRevision: 3,
    model: 'xiaomi.feeder.pi2001',
    vendor: 'xiaomi-pi2001',
  },
  {
    deviceRevision: 1,
    model: 'xiaomi.feeder.iv2001',
    vendor: 'xiaomi-iv2001',
  },
] as const;

test.each(VERIFIED_FEEDERS)(
  'matches the verified $model layout and selects the live bowl measurement',
  fixture => {
    const resources = resolveMiotEndpointConnectionResources(
      MiotPetFeederEndpointConnection,
      createSpec(fixture),
    );

    expect(MiotPetFeederEndpointConnection.Endpoint).toBe(PetFeederEndpoint);
    expect(resources?.map(({service}) => service.iid)).toEqual([2]);
    expect(Object.keys(resources?.[0]?.properties ?? {}).toSorted()).toEqual([
      'eaten-food-measure',
      'pet-food-left-level',
    ]);
    expect(resources?.[0]?.properties['eaten-food-measure']?.iid).toBe(22);
    expect(resources?.[0]?.properties['pet-food-left-level']).toMatchObject({
      iid: 6,
    });
  },
);

test('does not guess a bowl measurement IID for an unverified layout', () => {
  const spec = createSpec(VERIFIED_FEEDERS[0]);
  spec.type = 'urn:miot-spec-v2:device:pet-feeder:0000A06C:test-feeder:1';

  expect(
    resolveMiotEndpointConnectionResources(
      MiotPetFeederEndpointConnection,
      spec,
    ),
  ).toBeUndefined();
});

test('keeps sensor values unknown until observed and preserves an empty bowl', () => {
  const connection = createConnection(
    createSpec(VERIFIED_FEEDERS[0]),
    VERIFIED_FEEDERS[0],
    new TestTransport(),
  );

  expect(connection.foodLevel).toBeUndefined();
  expect(connection.bowlFoodWeight).toBeUndefined();

  connection.handleStateUpdate({
    did: connection.metadata.device.did,
    online: true,
    properties: [
      createPropertyUpdate(connection, 'pet-food-left-level', 1),
      createPropertyUpdate(connection, 'eaten-food-measure', 0),
    ],
  });

  expect(connection.ready).toBe(true);
  expect(connection.foodLevel).toBe('low');
  expect(connection.bowlFoodWeight).toBe(0);

  connection.handlePropertyUpdate(
    createPropertyUpdate(connection, 'eaten-food-measure', 6),
  );
  expect(connection.bowlFoodWeight).toBe(6);
});

test('keeps an unmapped but physically valid food level unknown', () => {
  const spec = createSpec(VERIFIED_FEEDERS[0]);
  const foodLevel = spec.services[0]?.properties?.find(
    property => property.iid === 6,
  );

  if (foodLevel === undefined) {
    throw new Error('Missing test food level property.');
  }

  foodLevel['value-list']?.push({value: 2, description: 'Unknown'});
  const connection = createConnection(
    spec,
    VERIFIED_FEEDERS[0],
    new TestTransport(),
  );

  expect(
    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [createPropertyUpdate(connection, 'pet-food-left-level', 2)],
    }),
  ).toEqual([]);
  expect(connection.foodLevel).toBeUndefined();
});

test('invokes every dispense command even when the portion count repeats', async () => {
  const transport = new TestTransport();
  const connection = createConnection(
    createSpec(VERIFIED_FEEDERS[0]),
    VERIFIED_FEEDERS[0],
    transport,
  );
  const first = connection.prepareCommand(new DispensePetFoodCommand(10));
  const second = connection.prepareCommand(new DispensePetFoodCommand(10));

  expect(first.effect).toBeUndefined();
  expect(first.toLogString?.()).toBe('dispense portions=10');
  await first.execute();
  await second.execute();

  expect(transport.requests).toEqual([
    new MiotInvokeActionRequest(
      {did: connection.metadata.device.did, siid: 2, aiid: 1},
      [{piid: 8, value: 10}],
    ),
    new MiotInvokeActionRequest(
      {did: connection.metadata.device.did, siid: 2, aiid: 1},
      [{piid: 8, value: 10}],
    ),
  ]);
});

test('accepts the declared portion range and rejects counts outside it', async () => {
  const transport = new TestTransport();
  const connection = createConnection(
    createSpec(VERIFIED_FEEDERS[0]),
    VERIFIED_FEEDERS[0],
    transport,
  );

  expect(() =>
    connection.prepareCommand(new DispensePetFoodCommand(151)),
  ).toThrow(CommandError);
  expect(transport.requests).toEqual([]);

  await connection.prepareCommand(new DispensePetFoodCommand(1)).execute();
  await connection.prepareCommand(new DispensePetFoodCommand(150)).execute();
  expect(transport.requests).toHaveLength(2);
});

test('rejects a portion count that is not aligned to the declared step', () => {
  const spec = createSpec(VERIFIED_FEEDERS[0]);
  const inputProperty = spec.services[0]?.properties?.find(
    property => property.iid === 8,
  );

  if (inputProperty === undefined) {
    throw new Error('Missing test dispense input property.');
  }

  inputProperty['value-range'] = [0, 150, 10];
  const connection = createConnection(
    spec,
    VERIFIED_FEEDERS[0],
    new TestTransport(),
  );

  expect(() =>
    connection.prepareCommand(new DispensePetFoodCommand(15)),
  ).toThrow(CommandError);
});

test.each(['missing action', 'duplicate action', 'wrong input'] as const)(
  'rejects an invalid dispense action: %s',
  scenario => {
    const spec = createSpec(VERIFIED_FEEDERS[0]);
    const service = spec.services[0];

    if (service === undefined) {
      throw new Error('Missing test pet feeder service.');
    }

    const [action] = service.actions ?? [];

    if (action === undefined) {
      throw new Error('Missing test dispense action.');
    }

    if (scenario === 'missing action') {
      service.actions = [];
    } else if (scenario === 'duplicate action') {
      service.actions = [action, {...action, iid: 2}];
    } else {
      service.actions = [{...action, in: [22]}];
    }

    expect(
      resolveMiotEndpointConnectionResources(
        MiotPetFeederEndpointConnection,
        spec,
      ),
    ).toBeUndefined();
  },
);

function createConnection(
  spec: MiotSpecInstance,
  fixture: (typeof VERIFIED_FEEDERS)[number],
  transport: TestTransport,
): MiotPetFeederEndpointConnection {
  const resources = resolveMiotEndpointConnectionResources(
    MiotPetFeederEndpointConnection,
    spec,
  );

  if (resources === undefined) {
    throw new Error('Test pet feeder did not resolve endpoint resources.');
  }

  const persistedMetadata = createMiotEndpointConnectionMetadata(
    {did: 'feeder-1', model: fixture.model},
    spec,
  );
  const metadata = resolveMiotEndpointConnectionMetadata(
    MiotPetFeederEndpointConnection,
    persistedMetadata,
    spec,
  );

  return new MiotPetFeederEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [transport],
  );
}

function createPropertyUpdate(
  connection: MiotPetFeederEndpointConnection,
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

function createSpec(
  fixture: (typeof VERIFIED_FEEDERS)[number],
): MiotSpecInstance {
  return {
    type: `urn:miot-spec-v2:device:pet-feeder:0000A06C:${fixture.vendor}:${fixture.deviceRevision}`,
    description: 'Pet Feeder',
    services: [createPetFeederService(fixture.vendor)],
  };
}

function createPetFeederService(vendor: string): MiotSpecService {
  const eatenFoodMeasureType = `urn:miot-spec-v2:property:eaten-food-measure:000002FA:${vendor}:1`;

  return {
    iid: 2,
    type: `urn:miot-spec-v2:service:pet-feeder:00007847:${vendor}:1`,
    description: 'Pet Feeder',
    properties: [
      {
        ...createProperty(
          6,
          `urn:miot-spec-v2:property:pet-food-left-level:0000010E:${vendor}:1`,
          'uint8',
        ),
        'value-list': [
          {value: 0, description: 'Normal'},
          {value: 1, description: 'Low'},
        ],
      },
      {
        ...createProperty(
          8,
          `urn:miot-spec-v2:property:feeding-measure:00000080:${vendor}:1`,
          'uint16',
          [0, 150, 1],
        ),
        access: [],
      },
      createProperty(18, eatenFoodMeasureType, 'uint16', [0, 65_535, 1]),
      createProperty(20, eatenFoodMeasureType, 'uint16', [0, 65_535, 1]),
      createProperty(22, eatenFoodMeasureType, 'uint16', [0, 65_535, 1]),
      createProperty(23, eatenFoodMeasureType, 'uint16', [0, 65_535, 1]),
    ],
    actions: [
      {
        iid: 1,
        type: `urn:miot-spec-v2:action:pet-food-out:0000282B:${vendor}:1`,
        description: 'Pet Food Out',
        in: [8],
        out: [],
      },
    ],
  };
}

function createProperty(
  iid: number,
  type: string,
  format: string,
  valueRange?: [number, number, number],
): MiotSpecProperty {
  return {
    iid,
    type,
    description: type,
    format,
    access: ['read', 'notify'],
    'value-range': valueRange,
  };
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
