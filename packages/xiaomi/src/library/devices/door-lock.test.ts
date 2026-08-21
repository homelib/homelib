import {
  DoorLockAlertEvent,
  DoorLockEndpoint,
  DoorLockOperationEvent,
} from '@homelib/core';

import {
  createMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionResources,
} from '../device.js';
import {
  type MiotEndpointConnectionResolvedMetadata,
  MiotEndpointConnectionTransport,
  type MiotEventUpdate,
  type MiotPropertyUpdate,
  getMiotEndpointConnectionEvent,
  getMiotEndpointConnectionProperty,
} from '../endpoint-connection.js';
import type {
  MiotEventArguments,
  MiotExecutionRequest,
  MiotExecutionResult,
  MiotSpecInstance,
  MiotSpecProperty,
  MiotSpecService,
} from '../miot/index.js';
import {MiotProvider} from '../provider.js';

import {MiotDoorLockEndpointConnection} from './door-lock.js';

const LOOCK_V5_DEVICE_TYPE = 'urn:miot-spec-v2:device:lock:0000A038:loock-v5:1';
const XIAOMI_B03_DEVICE_TYPE =
  'urn:miot-spec-v2:device:lock:0000A038:xiaomi-b03:1';

test.each([
  [LOOCK_V5_DEVICE_TYPE, [3, 2, 4], [1, 5, 1]],
  [XIAOMI_B03_DEVICE_TYPE, [3, 4, 2], [1021, 1003]],
] as const)(
  'matches the verified %s resources',
  (deviceType, serviceIids, propertyIids) => {
    const spec = createSpec(deviceType);
    const resources = resolveMiotEndpointConnectionResources(
      MiotDoorLockEndpointConnection,
      spec,
    );

    expect(MiotDoorLockEndpointConnection.Endpoint).toBe(DoorLockEndpoint);
    expect(resources?.map(resource => resource.service.iid)).toEqual(
      serviceIids,
    );
    expect(
      resources?.flatMap(resource =>
        Object.values(resource.properties).map(property => property.iid),
      ),
    ).toEqual(propertyIids);
    expect(
      resources?.find(resource => resource.service.iid === 2)?.events,
    ).toMatchObject({
      'lock-operation': expect.any(Object),
      'lock-alert': expect.any(Object),
    });
  },
);

test('rejects an unverified lock model and incorrect verified IIDs', () => {
  const unknown = createLoockV5Spec();
  unknown.type = 'urn:miot-spec-v2:device:lock:0000A038:unknown:1';

  expect(
    resolveMiotEndpointConnectionResources(
      MiotDoorLockEndpointConnection,
      unknown,
    ),
  ).toBeUndefined();

  const wrongIid = createLoockV5Spec();
  requireProperty(requireService(wrongIid, 3), 1).iid = 10;

  expect(
    resolveMiotEndpointConnectionResources(
      MiotDoorLockEndpointConnection,
      wrongIid,
    ),
  ).toBeUndefined();
});

test('projects loock-v5 lock, door, and battery state independently', () => {
  const {connection, metadata} = createConnection(createLoockV5Spec());
  const lockStatus = getMiotEndpointConnectionProperty(metadata, 'lock-status');
  const doorState = getMiotEndpointConnectionProperty(metadata, 'door-state');
  const batteryLevel = getMiotEndpointConnectionProperty(
    metadata,
    'battery-level',
  );

  connection.handleStateUpdate({
    did: metadata.device.did,
    online: true,
    properties: [
      createPropertyUpdate(metadata, lockStatus, 0),
      createPropertyUpdate(metadata, doorState, 1),
      createPropertyUpdate(metadata, batteryLevel, 98),
    ],
  });

  expect(connection.locked).toBe(false);
  expect(connection.doorState).toBe('closed');
  expect(connection.batteryLevel).toBe(0.98);

  connection.handleNotification({
    type: 'property-change',
    data: createPropertyUpdate(metadata, doorState, 0),
  });
  connection.handleNotification({
    type: 'property-change',
    data: createPropertyUpdate(metadata, lockStatus, 255),
  });

  expect(connection.locked).toBeUndefined();
  expect(connection.doorState).toBe('open');
});

test.each([
  [1, true, undefined],
  [2, false, undefined],
  [3, undefined, 'closed'],
  [4, undefined, 'ajar'],
  [5, undefined, 'open'],
  [6, undefined, 'ajar'],
  [17, true, undefined],
  [34, false, undefined],
  [51, undefined, 'closed'],
  [52, undefined, 'ajar'],
  [53, undefined, 'open'],
] as const)(
  'projects xiaomi-b03 door-state raw %i',
  (raw, locked, doorState) => {
    const {connection, metadata} = createConnection(createXiaomiB03Spec());
    const property = getMiotEndpointConnectionProperty(metadata, 'door-state');

    connection.handleStateUpdate({
      did: metadata.device.did,
      online: true,
      properties: [createPropertyUpdate(metadata, property, raw)],
    });

    expect(connection.locked).toBe(locked);
    expect(connection.doorState).toBe(doorState);
  },
);

test('normalizes xiaomi-b03 battery state', () => {
  const {connection, metadata} = createConnection(createXiaomiB03Spec());
  const battery = getMiotEndpointConnectionProperty(metadata, 'battery-level');

  connection.handleStateUpdate({
    did: metadata.device.did,
    online: true,
    properties: [createPropertyUpdate(metadata, battery, 46)],
  });

  expect(connection.batteryLevel).toBe(0.46);
});

test('retains independent xiaomi-b03 lock and door observations', () => {
  const {connection, metadata} = createConnection(createXiaomiB03Spec());
  const property = getMiotEndpointConnectionProperty(metadata, 'door-state');

  connection.handleStateUpdate({
    did: metadata.device.did,
    online: true,
    properties: [createPropertyUpdate(metadata, property, 1)],
  });
  connection.handleNotification({
    type: 'property-change',
    data: createPropertyUpdate(metadata, property, 3),
  });

  expect(connection.locked).toBe(true);
  expect(connection.doorState).toBe('closed');

  connection.handleNotification({
    type: 'property-change',
    data: createPropertyUpdate(metadata, property, 2),
  });

  expect(connection.locked).toBe(false);
  expect(connection.doorState).toBe('closed');
});

test('emits loock-v5 events despite its numeric vendor timestamp', () => {
  const {connection, metadata} = createConnection(createLoockV5Spec());
  const operations: DoorLockOperationEvent[] = [];
  const alerts: DoorLockAlertEvent[] = [];
  const operation = getMiotEndpointConnectionEvent(metadata, 'lock-operation');
  const alert = getMiotEndpointConnectionEvent(metadata, 'lock-alert');

  connection.onDoorLockOperation(event => operations.push(event));
  connection.onDoorLockAlert(event => alerts.push(event));
  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(metadata, operation, {
      type: 'identified',
      data: [
        {piid: 1, value: 2},
        {piid: 2, value: 7},
        {piid: 4, value: 1_777_000_000},
      ],
    }),
  });
  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(metadata, alert, {
      type: 'identified',
      data: [
        {piid: 3, value: 3},
        {piid: 4, value: 1_777_000_001},
      ],
    }),
  });

  expect(operations).toEqual([
    new DoorLockOperationEvent('unlock', 'fingerprint', 7),
  ]);
  expect(alerts).toEqual([new DoorLockAlertEvent('tampering')]);
  expect(operations[0]).toBeInstanceOf(DoorLockOperationEvent);
  expect(operations[0]?.position).toBeUndefined();
  expect(alerts[0]).toBeInstanceOf(DoorLockAlertEvent);
});

test('emits xiaomi-b03 operations and alerts from identified arguments', () => {
  const {connection, metadata} = createConnection(createXiaomiB03Spec());
  const operations: DoorLockOperationEvent[] = [];
  const alerts: DoorLockAlertEvent[] = [];
  const operation = getMiotEndpointConnectionEvent(metadata, 'lock-operation');
  const alert = getMiotEndpointConnectionEvent(metadata, 'lock-alert');

  connection.onDoorLockOperation(event => operations.push(event));
  connection.onDoorLockAlert(event => alerts.push(event));
  const operationNotification = {
    type: 'event',
    data: createEventUpdate(metadata, operation, {
      type: 'identified',
      data: [
        {piid: 6, value: 2},
        {piid: 5, value: 2},
        {piid: 4, value: 1_777_000_000},
        {piid: 3, value: 42},
        {piid: 2, value: 2},
      ],
    }),
  } as const;
  const insideOperationNotification = {
    type: 'event',
    data: createEventUpdate(metadata, operation, {
      type: 'identified',
      data: [
        {piid: 6, value: 2},
        {piid: 5, value: 1},
        {piid: 4, value: 1_777_000_000},
        {piid: 3, value: 42},
        {piid: 2, value: 2},
      ],
    }),
  } as const;
  const alertNotification = {
    type: 'event',
    data: createEventUpdate(metadata, alert, {
      type: 'identified',
      data: [
        {piid: 4, value: 1_777_000_001},
        {piid: 1, value: 2},
      ],
    }),
  } as const;

  connection.handleNotification(operationNotification);
  connection.handleNotification(operationNotification);
  connection.handleNotification(insideOperationNotification);
  connection.handleNotification(alertNotification);
  connection.handleNotification(alertNotification);

  expect(operations).toEqual([
    new DoorLockOperationEvent('unlock', 'fingerprint', 42, 'outside'),
    new DoorLockOperationEvent('unlock', 'fingerprint', 42, 'outside'),
    new DoorLockOperationEvent('unlock', 'fingerprint', 42, 'inside'),
  ]);
  expect(alerts).toEqual([
    new DoorLockAlertEvent('tampering'),
    new DoorLockAlertEvent('tampering'),
  ]);
  expect(operations[0]).not.toBe(operations[1]);
  expect(alerts[0]).not.toBe(alerts[1]);
});

test('ignores xiaomi-b03 lock events without a lock or unlock action', () => {
  const {connection, metadata} = createConnection(createXiaomiB03Spec());
  const operations: DoorLockOperationEvent[] = [];
  const operation = getMiotEndpointConnectionEvent(metadata, 'lock-operation');

  connection.onDoorLockOperation(event => operations.push(event));
  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(metadata, operation, {
      type: 'positional',
      data: [2, 42, 1_777_000_000, 2, 5],
    }),
  });

  expect(operations).toEqual([]);
});

test('rejects commands for the read-only connection', () => {
  const {connection} = createConnection(createLoockV5Spec());

  expect(() => connection.prepareCommand(undefined as never)).toThrow(
    'MIoT door lock does not support commands.',
  );
});

function createConnection(spec: MiotSpecInstance): {
  readonly connection: MiotDoorLockEndpointConnection;
  readonly metadata: MiotEndpointConnectionResolvedMetadata;
} {
  const identity = createMiotEndpointConnectionMetadata(
    {did: 'lock-1', model: 'test.lock'},
    spec,
  );
  const metadata = resolveMiotEndpointConnectionMetadata(
    MiotDoorLockEndpointConnection,
    identity,
    spec,
  );

  return {
    connection: new MiotDoorLockEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    ),
    metadata,
  };
}

function createSpec(deviceType: string): MiotSpecInstance {
  if (deviceType === LOOCK_V5_DEVICE_TYPE) {
    return createLoockV5Spec();
  } else if (deviceType === XIAOMI_B03_DEVICE_TYPE) {
    return createXiaomiB03Spec();
  }

  throw new TypeError(`Unsupported test lock: ${deviceType}.`);
}

function createLoockV5Spec(): MiotSpecInstance {
  return {
    type: LOOCK_V5_DEVICE_TYPE,
    description: 'Lock',
    services: [
      {
        iid: 2,
        type: 'urn:miot-spec-v2:service:lock:00007855:loock-v5:1',
        description: 'Lock',
        properties: [
          createValueListProperty(
            1,
            'urn:miot-spec-v2:property:operation-method:00000096:loock-v5:1',
            [],
            [0, 1, 2, 4, 6, 7, 8, 10],
          ),
          createRangeProperty(
            2,
            'urn:miot-spec-v2:property:operation-id:00000097:loock-v5:1',
            'uint32',
            [],
            [0, 4_294_967_295, 1],
          ),
          createValueListProperty(
            3,
            'urn:miot-spec-v2:property:abnormal-condition:00000095:loock-v5:1',
            [],
            [0, 1, 3, 4, 5, 6, 7, 11, 16],
          ),
          // The published instance says string, but verified firmware events
          // report this argument as a numeric Unix timestamp.
          createStringProperty(
            4,
            'urn:miot-spec-v2:property:current-time:00000098:loock-v5:1',
            [],
          ),
          createValueListProperty(
            5,
            'urn:miot-spec-v2:property:status:00000007:loock-v5:1',
            ['read', 'notify'],
            [0, 255],
          ),
        ],
        events: [
          {
            iid: 1,
            type: 'urn:miot-spec-v2:event:lock-opened:0000500E:loock-v5:1',
            description: 'Lock Opened',
            arguments: [1, 2, 4],
          },
          {
            iid: 4,
            type: 'urn:miot-spec-v2:event:exception-occurred:00005011:loock-v5:1',
            description: 'Exception Occurred',
            arguments: [3, 4],
          },
        ],
      },
      {
        iid: 3,
        type: 'urn:miot-spec-v2:service:door:00007856:loock-v5:1',
        description: 'Door',
        properties: [
          createValueListProperty(
            1,
            'urn:miot-spec-v2:property:status:00000007:loock-v5:1',
            ['read', 'notify'],
            [0, 1, 3, 255],
          ),
        ],
      },
      {
        iid: 4,
        type: 'urn:miot-spec-v2:service:battery:00007805:loock-v5:1',
        description: 'Battery',
        properties: [
          createRangeProperty(
            1,
            'urn:miot-spec-v2:property:battery-level:00000014:loock-v5:1',
            'uint8',
            ['read', 'notify'],
            [0, 100, 1],
          ),
        ],
      },
    ],
  };
}

function createXiaomiB03Spec(): MiotSpecInstance {
  return {
    type: XIAOMI_B03_DEVICE_TYPE,
    description: 'Lock',
    services: [
      {
        iid: 2,
        type: 'urn:miot-spec-v2:service:lock:00007855:xiaomi-b03:1',
        description: 'Lock',
        properties: [
          createValueListProperty(
            1,
            'urn:miot-spec-v2:property:abnormal-condition:00000095:xiaomi-b03:1',
            [],
            [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12],
          ),
          createValueListProperty(
            2,
            'urn:miot-spec-v2:property:operation-method:00000096:xiaomi-b03:1',
            [],
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          ),
          createRangeProperty(
            3,
            'urn:miot-spec-v2:property:operation-id:00000097:xiaomi-b03:1',
            'uint16',
            [],
            [0, 65_535, 1],
          ),
          createRangeProperty(
            4,
            'urn:miot-spec-v2:property:current-time:00000098:xiaomi-b03:1',
            'uint32',
            [],
            [0, 4_294_967_295, 1],
          ),
          createValueListProperty(
            5,
            'urn:miot-spec-v2:property:operation-position:00000128:xiaomi-b03:1',
            [],
            [1, 2],
          ),
          createValueListProperty(
            6,
            'urn:miot-spec-v2:property:lock-action:00000129:xiaomi-b03:1',
            [],
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
          ),
        ],
        events: [
          {
            iid: 1007,
            type: 'urn:miot-spec-v2:event:exception-occurred:00005011:xiaomi-b03:1',
            description: 'Exception Occurred',
            arguments: [1, 4],
          },
          {
            iid: 1020,
            type: 'urn:miot-spec-v2:event:lock-event:00005033:xiaomi-b03:1',
            description: 'Lock Event',
            arguments: [2, 3, 4, 5, 6],
          },
        ],
      },
      {
        iid: 3,
        type: 'urn:miot-spec-v2:service:door:00007856:xiaomi-b03:1',
        description: 'Door',
        properties: [
          createValueListProperty(
            1021,
            'urn:miot-spec-v2:property:door-state:0000006B:xiaomi-b03:1',
            ['read', 'notify'],
            [
              1, 2, 3, 4, 5, 6, 17, 18, 19, 20, 21, 22, 33, 34, 35, 36, 37, 38,
              49, 50, 51, 52, 53, 54,
            ],
          ),
        ],
      },
      {
        iid: 4,
        type: 'urn:miot-spec-v2:service:battery:00007805:xiaomi-b03:1',
        description: 'Battery',
        properties: [
          createRangeProperty(
            1003,
            'urn:miot-spec-v2:property:battery-level:00000014:xiaomi-b03:1',
            'uint8',
            ['read', 'notify'],
            [0, 100, 1],
          ),
        ],
      },
    ],
  };
}

function createValueListProperty(
  iid: number,
  type: string,
  access: string[],
  values: readonly number[],
): MiotSpecProperty {
  return {
    iid,
    type,
    description: type,
    format: 'uint8',
    access,
    'value-list': values.map(value => ({value, description: String(value)})),
  };
}

function createRangeProperty(
  iid: number,
  type: string,
  format: string,
  access: string[],
  valueRange: [number, number, number],
): MiotSpecProperty {
  return {
    iid,
    type,
    description: type,
    format,
    access,
    'value-range': valueRange,
  };
}

function createStringProperty(
  iid: number,
  type: string,
  access: string[],
): MiotSpecProperty {
  return {iid, type, description: type, format: 'string', access};
}

function createPropertyUpdate(
  metadata: MiotEndpointConnectionResolvedMetadata,
  target: ReturnType<typeof getMiotEndpointConnectionProperty>,
  value: unknown,
): MiotPropertyUpdate {
  return {
    did: metadata.device.did,
    siid: target.service.iid,
    piid: target.property.iid,
    value,
  };
}

function createEventUpdate(
  metadata: MiotEndpointConnectionResolvedMetadata,
  target: ReturnType<typeof getMiotEndpointConnectionEvent>,
  args: MiotEventArguments,
): MiotEventUpdate {
  return {
    did: metadata.device.did,
    siid: target.service.iid,
    eiid: target.event.iid,
    arguments: args,
  };
}

function requireService(spec: MiotSpecInstance, iid: number): MiotSpecService {
  const service = spec.services.find(candidate => candidate.iid === iid);

  if (service === undefined) {
    throw new Error(`Test lock has no service ${iid}.`);
  }

  return service;
}

function requireProperty(
  service: MiotSpecService,
  iid: number,
): MiotSpecProperty {
  const property = service.properties?.find(candidate => candidate.iid === iid);

  if (property === undefined) {
    throw new Error(`Test lock has no property ${iid}.`);
  }

  return property;
}

class TestTransport extends MiotEndpointConnectionTransport {
  override async executeRequest(
    _request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult> {
    return {code: 0};
  }
}
