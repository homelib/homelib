import {
  MotionAmbientLightLevelSensorEndpoint,
  MotionDetectedEvent,
  MotionSensorEndpoint,
} from '@homelib/core';

import {
  createMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionResources,
} from '../device.js';
import {
  type MiotEndpointConnectionResolvedMetadata,
  MiotEndpointConnectionTransport,
  type MiotEndpointStateUpdate,
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

import {MiotMotionAmbientLightLevelSensorEndpointConnection} from './motion-ambient-light-level-sensor.js';
import {MiotMotionSensorEndpointConnection} from './motion-sensor.js';

const NO_MOTION_DURATION_PROPERTY_TYPE =
  'urn:miot-spec-v2:property:no-motion-duration:000000CB:lumi-bmgl01:1';

const MOTION_DETECTED_EVENT_TYPE =
  'urn:miot-spec-v2:event:motion-detected:00005001:lumi-bmgl01:1';

const MOTION_CLEAR_TIMEOUT = 5 * 60_000;

test('matches the exact lumi.motion.bmgl01 motion and ambient light resources', () => {
  const spec = createSpec();
  const resources = resolveMiotEndpointConnectionResources(
    MiotMotionAmbientLightLevelSensorEndpointConnection,
    spec,
  );

  expect(MiotMotionAmbientLightLevelSensorEndpointConnection.Endpoint).toBe(
    MotionAmbientLightLevelSensorEndpoint,
  );
  expect(resources).toHaveLength(1);
  expect(resources?.[0]).toMatchObject({
    service: {iid: 2},
    properties: {
      'ambient-light-level': {
        iid: 1,
        access: ['read'],
      },
      'no-motion-duration': {iid: 2},
    },
    events: {'motion-detected': {iid: 1}},
  });

  const {connection} = createMotionAmbientLightLevelConnection(spec);

  expect(connection.snapshotProperties).toEqual([
    {did: 'sensor-1', siid: 2, piid: 1},
  ]);
  expect(connection.snapshotRefreshEvents).toEqual([
    {did: 'sensor-1', siid: 2, eiid: 1},
  ]);
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
  expect(connection.replaySnapshotPropertyNotifications).toEqual([]);
});

test('requires the exact lumi.motion.bmgl01 device and illumination property', () => {
  const wrongDevice = createSpec();
  wrongDevice.type =
    'urn:miot-spec-v2:device:motion-sensor:0000A014:lumi-bmgl01:2';

  expect(
    resolveMiotEndpointConnectionResources(
      MiotMotionAmbientLightLevelSensorEndpointConnection,
      wrongDevice,
    ),
  ).toBeUndefined();

  const missingIllumination = createSpec();
  const service = requireService(missingIllumination, 2);
  service.properties = service.properties?.filter(
    property => property.iid !== 1,
  );

  expect(
    resolveMiotEndpointConnectionResources(
      MiotMotionAmbientLightLevelSensorEndpointConnection,
      missingIllumination,
    ),
  ).toBeUndefined();

  const wrongIlluminationIid = createSpec();
  const [illumination] =
    requireService(wrongIlluminationIid, 2).properties ?? [];

  if (illumination === undefined) {
    throw new Error('Test sensor has no illumination property.');
  }

  illumination.iid = 4;

  expect(
    resolveMiotEndpointConnectionResources(
      MiotMotionAmbientLightLevelSensorEndpointConnection,
      wrongIlluminationIid,
    ),
  ).toBeUndefined();
});

test('fails closed with multiple exact motion and ambient light services', () => {
  const spec = createSpec();
  spec.services.push({...createMotionSensorService(), iid: 4});

  expect(
    resolveMiotEndpointConnectionResources(
      MiotMotionAmbientLightLevelSensorEndpointConnection,
      spec,
    ),
  ).toBeUndefined();
});

test.each([
  [1, 'low'],
  [2, 'high'],
])(
  'exposes illumination %i as ambientLightLevel=%s only for detected motion',
  (value, expected) => {
    const {connection, metadata, ambientLightLevel, motionDetected} =
      createMotionAmbientLightLevelConnection();
    const noMotionDuration = getMiotEndpointConnectionProperty(
      metadata,
      'no-motion-duration',
    );

    expect(connection.ready).toBe(false);
    expect(connection.motionDetected).toBeUndefined();
    expect(connection.ambientLightLevel).toBeUndefined();

    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [
        {
          did: connection.metadata.device.did,
          siid: ambientLightLevel.service.iid,
          piid: ambientLightLevel.property.iid,
          value,
        },
      ],
    });

    expect(connection.ready).toBe(true);
    expect(connection.motionDetected).toBe(false);
    expect(connection.ambientLightLevel).toBeUndefined();

    connection.handleNotification({
      type: 'event',
      data: createEventUpdate(connection, motionDetected),
    });

    expect(connection.motionDetected).toBe(true);
    expect(connection.ambientLightLevel).toBe(expected);

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
    expect(connection.ambientLightLevel).toBe(expected);

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
    expect(connection.ambientLightLevel).toBeUndefined();

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
    expect(connection.ambientLightLevel).toBeUndefined();

    connection.dispose();
  },
);

test('does not expose the initial snapshot for motion inferred without an event', () => {
  const {connection, metadata, ambientLightLevel} =
    createMotionAmbientLightLevelConnection();
  const noMotionDuration = getMiotEndpointConnectionProperty(
    metadata,
    'no-motion-duration',
  );

  connection.handleStateUpdate({
    did: connection.metadata.device.did,
    online: true,
    properties: [
      {
        did: connection.metadata.device.did,
        siid: ambientLightLevel.service.iid,
        piid: ambientLightLevel.property.iid,
        value: 1,
      },
    ],
  });
  connection.handleNotification({
    type: 'property-change',
    data: {
      did: connection.metadata.device.did,
      siid: noMotionDuration.service.iid,
      piid: noMotionDuration.property.iid,
      value: 0,
    },
  });

  expect(connection.ready).toBe(true);
  expect(connection.motionDetected).toBe(true);
  expect(connection.ambientLightLevel).toBeUndefined();

  connection.dispose();
});

test('becomes ready for an empty online snapshot', () => {
  const {connection} = createMotionAmbientLightLevelConnection();

  expect(
    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [],
    }),
  ).toEqual([]);
  expect(connection.ready).toBe(true);
  expect(connection.motionDetected).toBe(false);
  expect(connection.ambientLightLevel).toBeUndefined();

  connection.dispose();
});

test('never requests notification replay for a physical read-only property', () => {
  class ReplayAllMotionAmbientLightLevelSensorEndpointConnection extends MiotMotionAmbientLightLevelSensorEndpointConnection {
    protected override shouldReplaySnapshotPropertyNotifications(): boolean {
      return true;
    }
  }

  const resolved = createMotionAmbientLightLevelConnection();
  const {metadata} = resolved;
  resolved.connection.dispose();
  const connection =
    new ReplayAllMotionAmbientLightLevelSensorEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );

  expect(connection.replaySnapshotPropertyNotifications).toEqual([]);

  connection.dispose();
});

test('samples only available ambient light for each motion event', () => {
  const {connection, ambientLightLevel, motionDetected} =
    createMotionAmbientLightLevelConnection();
  const property = {
    did: connection.metadata.device.did,
    siid: ambientLightLevel.service.iid,
    piid: ambientLightLevel.property.iid,
  } as const;
  const updateSnapshot = (): void => {
    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [{...property, value: 1}],
    });
  };
  const eventAmbientLightLevels: Array<'low' | 'high' | undefined> = [];
  connection.onMotionDetected(() => {
    eventAmbientLightLevels.push(connection.ambientLightLevel);
  });

  updateSnapshot();
  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(connection, motionDetected),
  });
  expect(connection.motionDetected).toBe(true);
  expect(connection.ambientLightLevel).toBe('low');
  expect(eventAmbientLightLevels).toEqual(['low']);

  const revision = connection.stateRevision;

  expect(
    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [],
      invalidatedProperties: [property],
    }),
  ).toEqual([]);

  expect(connection.ready).toBe(true);
  expect(connection.motionDetected).toBe(true);
  expect(connection.ambientLightLevel).toBeUndefined();
  expect(connection.stateRevision).toBe(revision + 1);

  // An event-triggered refresh failure invalidates the new observation before
  // delivering the event. The previous successful sample must not leak into
  // this occurrence.
  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(connection, motionDetected),
  });
  expect(connection.motionDetected).toBe(true);
  expect(connection.ambientLightLevel).toBeUndefined();
  expect(eventAmbientLightLevels).toEqual(['low', undefined]);

  updateSnapshot();
  expect(connection.ambientLightLevel).toBeUndefined();

  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(connection, motionDetected),
  });
  expect(connection.ambientLightLevel).toBe('low');
  expect(eventAmbientLightLevels).toEqual(['low', undefined, 'low']);

  connection.handleSnapshotInvalidation([property]);
  expect(connection.motionDetected).toBe(true);
  expect(connection.ambientLightLevel).toBeUndefined();

  connection.dispose();
});

test('soft-invalidates invalid illumination state and resets ambient light offline', () => {
  const {connection, ambientLightLevel, motionDetected} =
    createMotionAmbientLightLevelConnection();
  const createUpdate = (value: unknown): MiotEndpointStateUpdate => ({
    did: connection.metadata.device.did,
    online: true,
    properties: [
      {
        did: connection.metadata.device.did,
        siid: ambientLightLevel.service.iid,
        piid: ambientLightLevel.property.iid,
        value,
      },
    ],
  });

  const invalidEnumErrors = connection.handleStateUpdate(createUpdate(3));
  expect(invalidEnumErrors).toHaveLength(1);
  expect(invalidEnumErrors[0]?.message).toBe(
    'Invalid MIoT value-list property state.',
  );
  expect(connection.ready).toBe(true);
  expect(connection.motionDetected).toBe(false);
  expect(connection.ambientLightLevel).toBeUndefined();

  const invalidTypeErrors = connection.handleStateUpdate(createUpdate('2'));
  expect(invalidTypeErrors).toHaveLength(1);
  expect(invalidTypeErrors[0]).toBeInstanceOf(TypeError);

  connection.handleStateUpdate(createUpdate(2));
  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(connection, motionDetected),
  });

  expect(connection.motionDetected).toBe(true);
  expect(connection.ambientLightLevel).toBe('high');

  const refreshErrors = connection.handleStateUpdate(createUpdate(3));
  expect(refreshErrors).toHaveLength(1);
  expect(connection.motionDetected).toBe(true);
  expect(connection.ambientLightLevel).toBeUndefined();

  connection.handleStateUpdate(createUpdate(2));
  expect(connection.ambientLightLevel).toBeUndefined();

  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(connection, motionDetected),
  });
  expect(connection.ambientLightLevel).toBe('high');

  connection.handleStateUpdate({
    did: connection.metadata.device.did,
    online: false,
    properties: [],
  });

  expect(connection.ready).toBe(false);
  expect(connection.motionDetected).toBeUndefined();
  expect(connection.ambientLightLevel).toBeUndefined();

  connection.handleStateUpdate(createUpdate(1));

  expect(connection.ready).toBe(true);
  expect(connection.motionDetected).toBe(false);
  expect(connection.ambientLightLevel).toBeUndefined();

  connection.dispose();
});

test('keeps an unmapped but physically valid illumination unknown', () => {
  const spec = createSpec();
  const illumination = requireService(spec, 2).properties?.find(
    property => property.iid === 1,
  );

  if (illumination === undefined) {
    throw new Error('Test sensor has no illumination property.');
  }

  illumination['value-list']?.push({value: 3, description: 'Unknown'});
  const {connection, ambientLightLevel, motionDetected} =
    createMotionAmbientLightLevelConnection(spec);

  expect(
    connection.handleStateUpdate({
      did: connection.metadata.device.did,
      online: true,
      properties: [
        {
          did: connection.metadata.device.did,
          siid: ambientLightLevel.service.iid,
          piid: ambientLightLevel.property.iid,
          value: 3,
        },
      ],
    }),
  ).toEqual([]);
  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(connection, motionDetected),
  });

  expect(connection.motionDetected).toBe(true);
  expect(connection.ambientLightLevel).toBeUndefined();

  connection.dispose();
});

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
  expect(connection.snapshotRefreshEvents).toEqual([]);
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
  const occurrences: MotionDetectedEvent[] = [];
  connection.onMotionDetected(event => occurrences.push(event));

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
  connection.handleNotification({
    type: 'event',
    data: createEventUpdate(connection, motionDetected),
  });

  expect(connection.motionDetected).toBe(true);
  expect(occurrences).toEqual([
    expect.any(MotionDetectedEvent),
    expect.any(MotionDetectedEvent),
  ]);
  expect(occurrences[0]).not.toBe(occurrences[1]);

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
    spec,
  );
  const metadata = resolveMiotEndpointConnectionMetadata(
    MiotMotionSensorEndpointConnection,
    persistedMetadata,
    spec,
  );
  const connection = new MiotMotionSensorEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [new TestTransport()],
  );

  expect(persistedMetadata).not.toHaveProperty('resources');
  expect(metadata.resources.map(({service}) => service.iid)).toEqual([2]);

  return {
    connection,
    metadata,
    motionDetected: getMiotEndpointConnectionEvent(metadata, 'motion-detected'),
  };
}

function createMotionAmbientLightLevelConnection(
  spec: MiotSpecInstance = createSpec(),
): {
  readonly connection: MiotMotionAmbientLightLevelSensorEndpointConnection;
  readonly metadata: MiotEndpointConnectionResolvedMetadata;
  readonly ambientLightLevel: ReturnType<
    typeof getMiotEndpointConnectionProperty
  >;
  readonly motionDetected: {
    readonly service: MiotSpecService;
    readonly event: MiotSpecEvent;
  };
} {
  const resources = resolveMiotEndpointConnectionResources(
    MiotMotionAmbientLightLevelSensorEndpointConnection,
    spec,
  );

  if (resources === undefined) {
    throw new Error(
      'Test motion ambient light level sensor did not resolve resources.',
    );
  }

  const persistedMetadata = createMiotEndpointConnectionMetadata(
    {did: 'sensor-1', model: 'lumi.motion.bmgl01'},
    spec,
  );
  const metadata = resolveMiotEndpointConnectionMetadata(
    MiotMotionAmbientLightLevelSensorEndpointConnection,
    persistedMetadata,
    spec,
  );
  const connection = new MiotMotionAmbientLightLevelSensorEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [new TestTransport()],
  );

  expect(persistedMetadata).not.toHaveProperty('resources');
  expect(metadata.resources.map(({service}) => service.iid)).toEqual([2]);

  return {
    connection,
    metadata,
    ambientLightLevel: getMiotEndpointConnectionProperty(
      metadata,
      'ambient-light-level',
    ),
    motionDetected: getMiotEndpointConnectionEvent(metadata, 'motion-detected'),
  };
}

function createEventUpdate(
  connection: {
    readonly metadata: MiotEndpointConnectionResolvedMetadata;
  },
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
