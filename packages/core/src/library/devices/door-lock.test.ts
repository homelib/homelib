import {action, observable} from 'mobx';

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
  DoorLock,
  DoorLockAlertEvent,
  DoorLockEndpoint,
  type DoorLockEndpointConnection,
  DoorLockOperationEvent,
} from './door-lock.js';

test('exposes independent lock, door, battery, and event capabilities', () => {
  const entry = new DeviceEntry('door lock');
  const lock = entry.createInstance(DoorLock);
  const endpoint = entry.getEndpoint();

  expect(lock.ready).toBe(false);
  expect(lock.locked).toBeUndefined();
  expect(lock.doorState).toBeUndefined();
  expect(lock.batteryLevel).toBeUndefined();

  if (!(endpoint instanceof DoorLockEndpoint)) {
    throw new Error('Expected a door-lock endpoint.');
  }

  const connection = new TestDoorLockEndpointConnection();
  const operations: DoorLockOperationEvent[] = [];
  const alerts: DoorLockAlertEvent[] = [];
  const stateLogEvents: EndpointStateLogEvent[] = [];
  const eventLogEvents: EndpointEventLogEvent[] = [];

  lock.onDoorLockOperation(event => operations.push(event));
  lock.onDoorLockAlert(event => alerts.push(event));
  const removeLogListener = addLogListener(event => {
    if (event.type === 'endpoint-state') {
      stateLogEvents.push(event);
    } else if (event.type === 'endpoint-event') {
      eventLogEvents.push(event);
    }
  });

  try {
    setEndpointLogTarget(endpoint, {
      scopePath: ['home'],
      deviceName: 'door lock',
      endpointName: '',
    });
    endpoint.bindConnection(connection);
    connection.update(false, 'closed', 0.8);
    const operation = new DoorLockOperationEvent(
      'unlock',
      'fingerprint',
      2,
      'outside',
    );
    const alert = new DoorLockAlertEvent('tampering');
    connection.operationEvent.emit(operation);
    connection.alertEvent.emit(alert);

    expect(lock.ready).toBe(true);
    expect(lock.locked).toBe(false);
    expect(lock.doorState).toBe('closed');
    expect(lock.batteryLevel).toBe(0.8);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toBe(operation);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toBe(alert);
    expect(stateLogEvents.map(event => event.state)).toEqual([
      {ready: false},
      {
        ready: true,
        locked: false,
        doorState: 'closed',
        batteryLevel: 0.8,
      },
    ]);
    expect(eventLogEvents.map(event => event.eventDescription)).toEqual([
      'doorLockOperation action="unlock" method="fingerprint" position="outside" operatorId=2',
      'doorLockAlert type="tampering"',
    ]);
  } finally {
    removeLogListener();
  }
});

class TestDoorLockEndpointConnection implements DoorLockEndpointConnection {
  readonly alertEvent = new DeviceEventEmitter<DoorLockAlertEvent>();

  readonly operationEvent = new DeviceEventEmitter<DoorLockOperationEvent>();

  readonly onDoorLockAlert = this.alertEvent.subscribe;

  readonly onDoorLockOperation = this.operationEvent.subscribe;

  @observable accessor ready = false;

  @observable accessor stateRevision = 0;

  @observable accessor batteryLevel: number | undefined;

  @observable accessor doorState: 'open' | 'closed' | 'ajar' | undefined;

  @observable accessor locked: boolean | undefined;

  @action
  update(
    locked: boolean | undefined,
    doorState: 'open' | 'closed' | 'ajar' | undefined,
    batteryLevel: number | undefined,
  ): void {
    this.locked = locked;
    this.doorState = doorState;
    this.batteryLevel = batteryLevel;
    this.stateRevision++;
    this.ready = true;
  }

  prepareCommand(_command: never): CommandExecution {
    throw new TypeError('Door locks do not support commands.');
  }
}
