import {action, observable} from 'mobx';

import {MotionDetectedEvent} from '../device/index.js';
import {DeviceEntry} from '../device.js';
import type {CommandExecution} from '../endpoint.js';
import {DeviceEventEmitter} from '../event.js';
import {
  type EndpointEventLogEvent,
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
  const motionEvents: void[] = [];
  sensor.onMotionDetected(() => motionEvents.push(undefined));
  const logEvents: EndpointStateLogEvent[] = [];
  const eventLogEvents: EndpointEventLogEvent[] = [];
  const removeLogListener = addLogListener(event => {
    if (event.type === 'endpoint-state') {
      logEvents.push(event);
    } else if (event.type === 'endpoint-event') {
      eventLogEvents.push(event);
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
    connection.motionDetectedEvent.emit(new MotionDetectedEvent());
    connection.motionDetectedEvent.emit(new MotionDetectedEvent());
    expect(motionEvents).toEqual([undefined, undefined]);
    expect(eventLogEvents.map(event => event.eventDescription)).toEqual([
      'motionDetected',
      'motionDetected',
    ]);
    expect(logEvents.map(event => event.state)).toEqual([
      {ready: false},
      {ready: true, motionDetected: true},
    ]);
  } finally {
    removeLogListener();
  }
});

test('keeps event subscriptions across connection replacement', () => {
  const entry = new DeviceEntry('sensor');
  const sensor = entry.createInstance(MotionSensor);
  const endpoint = entry.getEndpoint();
  const firstConnection = new TestMotionSensorEndpointConnection();
  const secondConnection = new TestMotionSensorEndpointConnection();
  const occurrences: void[] = [];

  if (!(endpoint instanceof MotionSensorEndpoint)) {
    throw new Error('Expected a motion sensor endpoint.');
  }

  sensor.onMotionDetected(() => occurrences.push(undefined));
  endpoint.bindConnection(firstConnection);
  firstConnection.motionDetectedEvent.emit(new MotionDetectedEvent());
  endpoint.bindConnection(secondConnection);
  firstConnection.motionDetectedEvent.emit(new MotionDetectedEvent());
  secondConnection.motionDetectedEvent.emit(new MotionDetectedEvent());

  expect(occurrences).toEqual([undefined, undefined]);
});

class TestMotionSensorEndpointConnection implements MotionSensorEndpointConnection {
  readonly motionDetectedEvent = new DeviceEventEmitter<MotionDetectedEvent>();

  readonly onMotionDetected = this.motionDetectedEvent.subscribe;

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
