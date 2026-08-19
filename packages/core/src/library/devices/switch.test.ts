import {action, observable} from 'mobx';

import {DeviceEntry} from '../device.js';
import type {CommandExecution} from '../endpoint.js';
import {
  type EndpointStateLogEvent,
  addLogListener,
  setEndpointLogTarget,
} from '../log.js';

import {
  SetSwitchOnCommand,
  Switch,
  SwitchEndpoint,
  type SwitchEndpointCommand,
  type SwitchEndpointConnection,
} from './switch.js';

test('switch exposes state and on/off commands', async () => {
  const entry = new DeviceEntry('switch');
  const switch_ = entry.createInstance(Switch);
  const endpoint = entry.getEndpoint();

  expect(switch_.on).toBe(false);

  if (!(endpoint instanceof SwitchEndpoint)) {
    throw new Error('Expected switch endpoint was not created.');
  }

  const connection = new TestSwitchEndpointConnection(true);
  endpoint.bindConnection(connection);

  expect(switch_.on).toBe(true);

  switch_.turnOff();
  await flushMicrotasks();
  switch_.turnOn();
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new SetSwitchOnCommand(false),
    new SetSwitchOnCommand(true),
  ]);
});

test('logs switch state updates', () => {
  const entry = new DeviceEntry('switch');
  entry.createInstance(Switch);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof SwitchEndpoint)) {
    throw new Error('Expected switch endpoint was not created.');
  }

  const connection = new ObservableTestSwitchEndpointConnection();
  const logEvents: EndpointStateLogEvent[] = [];
  const removeLogListener = addLogListener(event => {
    if (event.type === 'endpoint-state') {
      logEvents.push(event);
    }
  });

  try {
    setEndpointLogTarget(endpoint, {
      scopePath: ['home', 'room'],
      deviceName: 'switch',
      endpointName: '',
    });
    endpoint.bindConnection(connection);
    connection.initialize(true);

    expect(logEvents.map(event => event.state)).toEqual([
      {ready: false},
      {ready: true, on: true},
    ]);
  } finally {
    removeLogListener();
  }
});

class TestSwitchEndpointConnection implements SwitchEndpointConnection {
  readonly ready = true;

  readonly stateRevision = 0;

  readonly commands: SwitchEndpointCommand[] = [];

  constructor(readonly on: boolean) {}

  prepareCommand(command: SwitchEndpointCommand): CommandExecution {
    return {
      execute: async () => {
        this.commands.push(command);
      },
    };
  }
}

class ObservableTestSwitchEndpointConnection implements SwitchEndpointConnection {
  @observable accessor ready = false;

  @observable accessor stateRevision = 0;

  @observable accessor on = false;

  @action
  initialize(on: boolean): void {
    this.on = on;
    this.stateRevision++;
    this.ready = true;
  }

  prepareCommand(_command: SwitchEndpointCommand): CommandExecution {
    return {execute: () => Promise.resolve()};
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
