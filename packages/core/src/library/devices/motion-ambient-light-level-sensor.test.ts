import {action, observable} from 'mobx';

import type {AmbientLightLevel} from '../device/index.js';
import {DeviceEntry} from '../device.js';
import type {CommandExecution} from '../endpoint.js';
import {
  type EndpointStateLogEvent,
  addLogListener,
  setEndpointLogTarget,
} from '../log.js';

import {
  MotionAmbientLightLevelSensor,
  MotionAmbientLightLevelSensorEndpoint,
  type MotionAmbientLightLevelSensorEndpointConnection,
} from './motion-ambient-light-level-sensor.js';

test('exposes ambient light level only while motion is detected', () => {
  const entry = new DeviceEntry('sensor');
  const sensor = entry.createInstance(MotionAmbientLightLevelSensor);
  const endpoint = entry.getEndpoint();

  expect(sensor.ready).toBe(false);
  expect(sensor.motionDetected).toBeUndefined();
  expect(sensor.ambientLightLevel).toBeUndefined();

  if (!(endpoint instanceof MotionAmbientLightLevelSensorEndpoint)) {
    throw new Error('Expected a motion ambient light level sensor endpoint.');
  }

  const connection = new TestMotionAmbientLightLevelSensorEndpointConnection();
  const logEvents: EndpointStateLogEvent[] = [];
  const removeLogListener = addLogListener(event => {
    if (event.type === 'endpoint-state') {
      logEvents.push(event);
    }
  });

  try {
    setEndpointLogTarget(endpoint, {
      scopePath: ['home', 'room'],
      deviceName: 'sensor',
      endpointName: '',
    });
    endpoint.bindConnection(connection);
    connection.update(false, 'low');

    expect(sensor.ready).toBe(true);
    expect(sensor.motionDetected).toBe(false);
    expect(sensor.ambientLightLevel).toBeUndefined();

    connection.update(undefined, 'high');

    expect(sensor.motionDetected).toBeUndefined();
    expect(sensor.ambientLightLevel).toBeUndefined();

    connection.update(true, 'high');

    expect(sensor.motionDetected).toBe(true);
    expect(sensor.ambientLightLevel).toBe('high');

    connection.update(false, 'low');

    expect(sensor.motionDetected).toBe(false);
    expect(sensor.ambientLightLevel).toBeUndefined();
    expect(logEvents.map(event => event.state)).toEqual([
      {ready: false},
      {
        ready: true,
        motionDetected: false,
        ambientLightLevel: undefined,
      },
      {
        ready: true,
        motionDetected: undefined,
        ambientLightLevel: undefined,
      },
      {ready: true, motionDetected: true, ambientLightLevel: 'high'},
      {
        ready: true,
        motionDetected: false,
        ambientLightLevel: undefined,
      },
    ]);
  } finally {
    removeLogListener();
  }
});

class TestMotionAmbientLightLevelSensorEndpointConnection implements MotionAmbientLightLevelSensorEndpointConnection {
  @observable accessor ready = false;

  @observable accessor stateRevision = 0;

  @observable accessor motionDetected: boolean | undefined;

  @observable accessor ambientLightLevel: AmbientLightLevel | undefined;

  @action
  update(
    motionDetected: boolean | undefined,
    ambientLightLevel: AmbientLightLevel | undefined,
  ): void {
    this.motionDetected = motionDetected;
    this.ambientLightLevel = ambientLightLevel;
    this.stateRevision++;
    this.ready = true;
  }

  prepareCommand(_command: never): CommandExecution {
    throw new TypeError(
      'Motion ambient light level sensors do not support commands.',
    );
  }
}
