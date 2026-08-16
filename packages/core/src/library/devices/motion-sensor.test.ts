import {action, observable} from 'mobx';

import {DeviceEntry} from '../device.js';
import type {CommandExecution} from '../endpoint.js';
import {
  type EndpointStateLogEvent,
  addLogListener,
  setEndpointLogTarget,
} from '../log.js';

import {
  MotionSensor,
  MotionSensorEndpoint,
  type MotionSensorEndpointConnection,
} from './motion-sensor.js';

test('exposes motion detection from one endpoint', () => {
  const entry = new DeviceEntry('sensor');
  const sensor = entry.createInstance(MotionSensor);
  const endpoint = entry.getEndpoint();

  expect(sensor.ready).toBe(false);
  expect(sensor.motionDetected).toBeUndefined();

  if (!(endpoint instanceof MotionSensorEndpoint)) {
    throw new Error('Expected a motion sensor endpoint.');
  }

  const connection = new TestMotionSensorEndpointConnection();
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
    connection.initialize(true);

    expect(sensor.ready).toBe(true);
    expect(sensor.motionDetected).toBe(true);
    expect(logEvents.map(event => event.state)).toEqual([
      {ready: false},
      {ready: true, motionDetected: true},
    ]);
  } finally {
    removeLogListener();
  }
});

class TestMotionSensorEndpointConnection implements MotionSensorEndpointConnection {
  @observable accessor ready = false;

  @observable accessor stateRevision = 0;

  @observable accessor motionDetected: boolean | undefined;

  @action
  initialize(motionDetected: boolean): void {
    this.motionDetected = motionDetected;
    this.stateRevision++;
    this.ready = true;
  }

  prepareCommand(_command: never): CommandExecution {
    throw new TypeError('Motion sensors do not support commands.');
  }
}
