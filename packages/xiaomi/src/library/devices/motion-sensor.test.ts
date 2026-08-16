import {MotionSensorEndpoint} from '@homelib/core';

import {
  createMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionResources,
} from '../device.js';
import {
  type MiotEndpointConnectionResolvedMetadata,
  MiotEndpointConnectionTransport,
  type MiotEventUpdate,
  getMiotEndpointConnectionEvent,
  getMiotEndpointConnectionProperty,
} from '../endpoint-connection.js';
import type {
  MiotExecutionRequest,
  MiotExecutionResult,
  MiotSpecEvent,
  MiotSpecInstance,
  MiotSpecService,
} from '../miot/index.js';
import {MiotProvider} from '../provider.js';

import {MiotMotionSensorEndpointConnection} from './motion-sensor.js';

const NO_MOTION_DURATION_PROPERTY_TYPE =
  'urn:miot-spec-v2:property:no-motion-duration:000000CB:lumi-bmgl01:1';

const MOTION_DETECTED_EVENT_TYPE =
  'urn:miot-spec-v2:event:motion-detected:00005001:lumi-bmgl01:1';

const MOTION_CLEAR_TIMEOUT = 5 * 60_000;

test('matches the official motion sensor service with events', () => {
  const spec = createSpec();
  const resources = resolveMiotEndpointConnectionResources(
    MiotMotionSensorEndpointConnection,
    spec,
  );

  expect(MiotMotionSensorEndpointConnection.Endpoint).toBe(
    MotionSensorEndpoint,
  );
  expect(resources).toHaveLength(1);
  expect(resources?.[0]).toMatchObject({
    service: {iid: 2},
    properties: {'no-motion-duration': {iid: 2}},
    events: {'motion-detected': {iid: 1}},
  });
  expect(
    resources?.[0]?.properties?.['no-motion-duration']?.['value-list'],
  ).toEqual([
    {value: 0, description: '0 Seconds'},
    {value: 2, description: '2 Minutes'},
    {value: 5, description: '5 Minutes'},
  ]);

  const {connection} = createConnection(spec);

  expect(connection.snapshotProperties).toEqual([]);
  expect(connection.notificationTargets).toEqual([
    {
      type: 'property-change',
      data: {did: 'sensor-1', siid: 2, piid: 2},
    },
    {
      type: 'event',
      data: {did: 'sensor-1', siid: 2, eiid: 1},
    },
  ]);
});

test('matches and becomes ready without the no-motion-duration property', () => {
  const spec = createSpec();
  const service = requireService(spec, 2);
  service.properties = service.properties?.filter(
    property => property.type !== NO_MOTION_DURATION_PROPERTY_TYPE,
  );
  const resources = resolveMiotEndpointConnectionResources(
    MiotMotionSensorEndpointConnection,
    spec,
  );

  expect(resources).toHaveLength(1);
  expect(resources?.[0]).toMatchObject({
    service: {iid: 2},
    properties: {},
    events: {'motion-detected': {iid: 1}},
  });

  const {connection, motionDetected} = createConnection(spec);

  expect(connection.snapshotProperties).toEqual([]);
  expect(connection.notificationTargets).toEqual([
    {
      type: 'event',
      data: {did: 'sensor-1', siid: 2, eiid: 1},
    },
  ]);
  expect(connection.ready).toBe(false);
  expect(connection.motionDetected).toBeUndefined();

  connection.handleStateUpdate({
    did: connection.metadata.device.did,
    online: true,
    properties: [],
  });

  expect(connection.ready).toBe(true);
  expect(connection.motionDetected).toBe(false);

  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(connection, motionDetected),
  });

  expect(connection.motionDetected).toBe(true);

  connection.dispose();
});

test('requires the motion-detected event', () => {
  const spec = createSpec();
  const service = requireService(spec, 2);
  service.events = service.events?.filter(
    event => event.type !== MOTION_DETECTED_EVENT_TYPE,
  );

  expect(
    resolveMiotEndpointConnectionResources(
      MiotMotionSensorEndpointConnection,
      spec,
    ),
  ).toBeUndefined();
});

test('fails closed with multiple relevant services', () => {
  const spec = createSpec();
  spec.services.push({...createMotionSensorService(), iid: 4});

  expect(
    resolveMiotEndpointConnectionResources(
      MiotMotionSensorEndpointConnection,
      spec,
    ),
  ).toBeUndefined();
});

test.each([
  [0, true],
  [2, false],
  [5, false],
])(
  'updates motion state from a %i no-motion-duration notification',
  (value, expected) => {
    const {connection, metadata} = createConnection();
    const noMotionDuration = getMiotEndpointConnectionProperty(
      metadata,
      'no-motion-duration',
    );

    expect(connection.ready).toBe(false);
    expect(connection.motionDetected).toBeUndefined();

    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [],
    });

    expect(connection.ready).toBe(true);
    expect(connection.motionDetected).toBe(false);

    connection.handleNotification({
      type: 'property-change',
      data: {
        did: connection.metadata.device.did,
        siid: noMotionDuration.service.iid,
        piid: noMotionDuration.property.iid,
        value,
      },
    });

    expect(connection.motionDetected).toBe(expected);

    connection.dispose();
  },
);

test('rejects non-numeric no-motion-duration state', () => {
  const {connection, metadata} = createConnection();
  const noMotionDuration = getMiotEndpointConnectionProperty(
    metadata,
    'no-motion-duration',
  );

  expect(() =>
    connection.handleNotification({
      type: 'property-change',
      data: {
        did: connection.metadata.device.did,
        siid: noMotionDuration.service.iid,
        piid: noMotionDuration.property.iid,
        value: '0',
      },
    }),
  ).toThrow(TypeError);
});

test('motion events set the detected state and clear after the local timeout', () => {
  import.meta.jest.useFakeTimers();

  try {
    const {connection, motionDetected} = createConnection();

    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [],
    });

    expect(connection.ready).toBe(true);

    connection.handleNotification({
      type: 'event',
      data: createEventUpdate(connection, motionDetected),
    });

    expect(connection.motionDetected).toBe(true);

    import.meta.jest.advanceTimersByTime(MOTION_CLEAR_TIMEOUT - 1);

    expect(connection.motionDetected).toBe(true);

    import.meta.jest.advanceTimersByTime(1);

    expect(connection.motionDetected).toBe(false);
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test('repeated events reset the motion clear timeout', () => {
  import.meta.jest.useFakeTimers();

  try {
    const {connection, motionDetected} = createConnection();

    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [],
    });

    const notification = {
      type: 'event' as const,
      data: createEventUpdate(connection, motionDetected),
    };

    connection.handleNotification(notification);

    import.meta.jest.advanceTimersByTime(4 * 60_000);
    connection.handleNotification(notification);

    import.meta.jest.advanceTimersByTime(4 * 60_000);

    expect(connection.motionDetected).toBe(true);

    import.meta.jest.advanceTimersByTime(60_000);

    expect(connection.motionDetected).toBe(false);
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test('local motion clears advance the state revision', () => {
  import.meta.jest.useFakeTimers();

  try {
    const {connection, motionDetected} = createConnection();

    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [],
    });
    connection.handleNotification({
      type: 'event',
      data: createEventUpdate(connection, motionDetected),
    });

    const revision = connection.stateRevision;

    import.meta.jest.advanceTimersByTime(MOTION_CLEAR_TIMEOUT);

    expect(connection.motionDetected).toBe(false);
    expect(connection.stateRevision).toBe(revision + 1);
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test('dispose cancels the motion clear timeout', () => {
  import.meta.jest.useFakeTimers();

  try {
    const {connection, motionDetected} = createConnection();

    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [],
    });
    connection.handleNotification({
      type: 'event',
      data: createEventUpdate(connection, motionDetected),
    });

    expect(connection.motionDetected).toBe(true);

    const revision = connection.stateRevision;

    connection.dispose();

    import.meta.jest.advanceTimersByTime(10 * 60_000);

    expect(connection.motionDetected).toBe(true);
    expect(connection.stateRevision).toBe(revision);
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test('motion events before the initial state leave the sensor state undefined', () => {
  const {connection, motionDetected} = createConnection();

  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(connection, motionDetected),
  });

  expect(connection.ready).toBe(false);
  expect(connection.motionDetected).toBeUndefined();

  connection.handleStateUpdate({
    did: connection.metadata.device.did,
    online: true,
    properties: [],
  });

  expect(connection.ready).toBe(true);
  expect(connection.motionDetected).toBe(true);

  connection.dispose();
});

test('applies property and event notifications in delivery order with one revision each', () => {
  const {connection, metadata, motionDetected} = createConnection();
  const noMotionDuration = getMiotEndpointConnectionProperty(
    metadata,
    'no-motion-duration',
  );

  connection.handleStateUpdate({
    did: connection.metadata.device.did,
    online: true,
    properties: [],
  });

  let revision = connection.stateRevision;

  connection.handleNotification({
    type: 'property-change',
    data: {
      did: connection.metadata.device.did,
      siid: noMotionDuration.service.iid,
      piid: noMotionDuration.property.iid,
      value: 2,
    },
  });
  expect(connection.motionDetected).toBe(false);
  revision += 1;
  expect(connection.stateRevision).toBe(revision);

  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(connection, motionDetected),
  });
  expect(connection.motionDetected).toBe(true);
  revision += 1;
  expect(connection.stateRevision).toBe(revision);

  connection.handleNotification({
    type: 'property-change',
    data: {
      did: connection.metadata.device.did,
      siid: noMotionDuration.service.iid,
      piid: noMotionDuration.property.iid,
      value: 5,
    },
  });
  expect(connection.motionDetected).toBe(false);
  revision += 1;
  expect(connection.stateRevision).toBe(revision);

  connection.handleNotification({
    type: 'property-change',
    data: {
      did: connection.metadata.device.did,
      siid: noMotionDuration.service.iid,
      piid: noMotionDuration.property.iid,
      value: 0,
    },
  });
  expect(connection.motionDetected).toBe(true);
  revision += 1;
  expect(connection.stateRevision).toBe(revision);

  connection.dispose();
});

test('offline invalidates motion and reconnect does not expose stale state', () => {
  import.meta.jest.useFakeTimers();

  try {
    const {connection, motionDetected} = createConnection();

    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [],
    });
    connection.handleNotification({
      type: 'event',
      data: createEventUpdate(connection, motionDetected),
    });

    expect(connection.motionDetected).toBe(true);

    let revision = connection.stateRevision;

    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: false,
      properties: [],
    });

    expect(connection.ready).toBe(false);
    expect(connection.motionDetected).toBeUndefined();
    revision += 1;
    expect(connection.stateRevision).toBe(revision);

    import.meta.jest.advanceTimersByTime(MOTION_CLEAR_TIMEOUT * 2);

    expect(connection.stateRevision).toBe(revision);

    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [],
    });

    expect(connection.ready).toBe(true);
    expect(connection.motionDetected).toBe(false);
    revision += 1;
    expect(connection.stateRevision).toBe(revision);

    connection.dispose();
  } finally {
    import.meta.jest.useRealTimers();
  }
});

test('rejects unexpected events', () => {
  const {connection, motionDetected} = createConnection();

  expect(() =>
    connection.handleNotification({
      type: 'event',
      data: {
        did: 'other-sensor',
        siid: motionDetected.service.iid,
        eiid: motionDetected.event.iid,
        arguments: {type: 'identified', data: []},
      },
    }),
  ).toThrow(TypeError);

  expect(() =>
    connection.handleNotification({
      type: 'event',
      data: {
        did: connection.metadata.device.did,
        siid: 3,
        eiid: motionDetected.event.iid,
        arguments: {type: 'identified', data: []},
      },
    }),
  ).toThrow(TypeError);

  expect(() =>
    connection.handleNotification({
      type: 'event',
      data: {
        did: connection.metadata.device.did,
        siid: motionDetected.service.iid,
        eiid: 999,
        arguments: {type: 'identified', data: []},
      },
    }),
  ).toThrow(TypeError);

  expect(() =>
    connection.handleNotification({
      type: 'event',
      data: {
        did: connection.metadata.device.did,
        siid: motionDetected.service.iid,
        eiid: motionDetected.event.iid,
        arguments: {
          type: 'identified',
          data: [{piid: 1005, value: true}],
        },
      },
    }),
  ).toThrow(TypeError);
});

/**
 * Verbatim snapshot of the official Xiaomi motion sensor 2
 * (lumi.motion.bmgl01) instance spec, which reports motion through the
 * motion-detected event.
 */
function createSpec(): MiotSpecInstance {
  return {
    type: 'urn:miot-spec-v2:device:motion-sensor:0000A014:lumi-bmgl01:1',
    description: 'Motion Sensor',
    services: [
      createDeviceInformationService(),
      createMotionSensorService(),
      createBatteryService(),
    ],
  };
}

function createDeviceInformationService(): MiotSpecService {
  return {
    iid: 1,
    type: 'urn:miot-spec-v2:service:device-information:00007801:lumi-bmgl01:1',
    description: 'Device Information',
    properties: [
      {
        iid: 1,
        type: 'urn:miot-spec-v2:property:manufacturer:00000001:lumi-bmgl01:1',
        description: 'Device Manufacturer',
        format: 'string',
        access: ['read'],
      },
      {
        iid: 2,
        type: 'urn:miot-spec-v2:property:model:00000002:lumi-bmgl01:1',
        description: 'Device Model',
        format: 'string',
        access: ['read'],
      },
      {
        iid: 3,
        type: 'urn:miot-spec-v2:property:serial-number:00000003:lumi-bmgl01:1',
        description: 'Device ID',
        format: 'string',
        access: ['read'],
      },
      {
        iid: 4,
        type: 'urn:miot-spec-v2:property:firmware-revision:00000005:lumi-bmgl01:1',
        description: 'Current Firmware Version',
        format: 'string',
        access: ['read'],
      },
    ],
  };
}

function createMotionSensorService(): MiotSpecService {
  return {
    iid: 2,
    type: 'urn:miot-spec-v2:service:motion-sensor:00007825:lumi-bmgl01:1',
    description: 'Motion Sensor',
    properties: [
      {
        iid: 1,
        type: 'urn:miot-spec-v2:property:illumination:0000004E:lumi-bmgl01:1',
        description: 'Illumination',
        format: 'float',
        access: ['read'],
        'value-list': [
          {value: 1, description: 'Weak'},
          {value: 2, description: 'Strong'},
        ],
      },
      {
        iid: 2,
        type: NO_MOTION_DURATION_PROPERTY_TYPE,
        description: 'No Motion Duration',
        format: 'uint16',
        access: ['read', 'notify'],
        unit: 'minutes',
        'value-list': [
          {value: 2, description: '2 Minutes'},
          {value: 5, description: '5 Minutes'},
        ],
      },
    ],
    events: [
      {
        iid: 1,
        type: MOTION_DETECTED_EVENT_TYPE,
        description: 'Motion Detected',
        arguments: [],
      },
    ],
  };
}

function createBatteryService(): MiotSpecService {
  return {
    iid: 3,
    type: 'urn:miot-spec-v2:service:battery:00007805:lumi-bmgl01:1',
    description: 'Battery',
    properties: [
      {
        iid: 1,
        type: 'urn:miot-spec-v2:property:battery-level:00000014:lumi-bmgl01:1',
        description: 'Battery Level',
        format: 'uint8',
        access: ['read'],
        unit: 'percentage',
        'value-range': [0, 100, 1],
      },
    ],
  };
}

function requireService(spec: MiotSpecInstance, iid: number): MiotSpecService {
  const service = spec.services.find(candidate => candidate.iid === iid);

  if (service === undefined) {
    throw new Error(`Test spec has no service ${iid}.`);
  }

  return service;
}

function createConnection(spec: MiotSpecInstance = createSpec()): {
  readonly connection: MiotMotionSensorEndpointConnection;
  readonly metadata: MiotEndpointConnectionResolvedMetadata;
  readonly motionDetected: {
    readonly service: MiotSpecService;
    readonly event: MiotSpecEvent;
  };
} {
  const resources = resolveMiotEndpointConnectionResources(
    MiotMotionSensorEndpointConnection,
    spec,
  );

  if (resources === undefined) {
    throw new Error('Test sensor did not resolve endpoint resources.');
  }

  const persistedMetadata = createMiotEndpointConnectionMetadata(
    {did: 'sensor-1', model: 'lumi.motion.bmgl01'},
    spec.type,
    resources,
  );
  const metadata = resolveMiotEndpointConnectionMetadata(
    MiotMotionSensorEndpointConnection,
    persistedMetadata,
  );
  const connection = new MiotMotionSensorEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [new TestTransport()],
  );

  expect(persistedMetadata.resources).toEqual([
    {service: expect.objectContaining({iid: 2})},
  ]);
  expect(persistedMetadata.resources[0]).not.toHaveProperty('properties');
  expect(persistedMetadata.resources[0]).not.toHaveProperty('events');

  return {
    connection,
    metadata,
    motionDetected: getMiotEndpointConnectionEvent(metadata, 'motion-detected'),
  };
}

function createEventUpdate(
  connection: MiotMotionSensorEndpointConnection,
  motionDetected: {
    readonly service: MiotSpecService;
    readonly event: MiotSpecEvent;
  },
): MiotEventUpdate {
  return {
    did: connection.metadata.device.did,
    siid: motionDetected.service.iid,
    eiid: motionDetected.event.iid,
    arguments: {type: 'identified', data: []},
  };
}

class TestTransport extends MiotEndpointConnectionTransport {
  override executeRequest(
    _request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult> {
    throw new TypeError('Motion sensor transport does not execute commands.');
  }
}
