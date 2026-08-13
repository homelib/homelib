import type {Temperature} from '../atomics/index.js';
import {DeviceEntry} from '../device.js';

import {
  Dehumidifier,
  DehumidifierEndpoint,
  type DehumidifierEndpointCommand,
  type DehumidifierEndpointConnection,
  SetDehumidifierModeCommand,
  SetDehumidifierOnCommand,
  SetDehumidifierTargetHumidityCommand,
} from './dehumidifier.js';

test('dehumidifier power commands support chaining', () => {
  const entry = new DeviceEntry('dehumidifier');
  const dehumidifier = entry.createInstance(Dehumidifier);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof DehumidifierEndpoint)) {
    throw new TypeError('Expected a dehumidifier endpoint.');
  }

  expect(dehumidifier.turnOn().turnOff()).toBe(dehumidifier);
  expect(endpoint.turnOn().turnOff()).toBe(endpoint);
});

test('chains dehumidifier setters after ensuring it is on', async () => {
  const {connection, dehumidifier, endpoint} = createDehumidifier(false);

  expect(dehumidifier.ensureOn().setMode('sleep').setTargetHumidity(0.5)).toBe(
    dehumidifier,
  );
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new SetDehumidifierOnCommand(true),
    new SetDehumidifierModeCommand('sleep'),
    new SetDehumidifierTargetHumidityCommand(0.5),
  ]);
  expect(endpoint.setMode('auto')).toBe(endpoint);
  expect(endpoint.setTargetHumidity(0.45)).toBe(endpoint);
  await flushMicrotasks();
});

test('does not enqueue a command when ensuring an active dehumidifier is on', async () => {
  const {connection, dehumidifier, endpoint} = createDehumidifier(true);

  expect(dehumidifier.ensureOn()).toBe(dehumidifier);
  expect(endpoint.ensureOn()).toBe(endpoint);
  await flushMicrotasks();

  expect(connection.commands).toEqual([]);
});

function createDehumidifier(on: boolean): {
  connection: TestDehumidifierEndpointConnection;
  dehumidifier: Dehumidifier;
  endpoint: DehumidifierEndpoint;
} {
  const entry = new DeviceEntry('dehumidifier');
  const dehumidifier = entry.createInstance(Dehumidifier);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof DehumidifierEndpoint)) {
    throw new TypeError('Expected a dehumidifier endpoint.');
  }

  const connection = new TestDehumidifierEndpointConnection(on);
  endpoint.bindConnection(connection);

  return {connection, dehumidifier, endpoint};
}

class TestDehumidifierEndpointConnection implements DehumidifierEndpointConnection {
  readonly ready = true;

  readonly mode = 'auto' as const;

  readonly targetRelativeHumidity = 0.5;

  readonly temperature: Temperature | undefined;

  readonly relativeHumidity = 0.5;

  readonly commands: DehumidifierEndpointCommand[] = [];

  constructor(readonly on: boolean) {}

  async processCommand(command: DehumidifierEndpointCommand): Promise<void> {
    this.commands.push(command);
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
