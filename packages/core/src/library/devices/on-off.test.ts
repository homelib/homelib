import type {Command} from '../command.js';
import {type Device, type DeviceConstructor, DeviceEntry} from '../device.js';
import type {Endpoint, EndpointConnection} from '../endpoint.js';

import {
  AirConditioner,
  AirConditionerEndpoint,
  SetAirConditionerOnCommand,
} from './air-conditioner.js';
import {
  Dehumidifier,
  DehumidifierEndpoint,
  SetDehumidifierOnCommand,
} from './dehumidifier.js';
import {Fan, FanEndpoint, SetFanOnCommand} from './fan.js';

test('air conditioner exposes state and on/off commands', async () => {
  await expectOnOffDevice(
    AirConditioner,
    AirConditionerEndpoint,
    SetAirConditionerOnCommand,
  );
});

test('dehumidifier exposes state and on/off commands', async () => {
  await expectOnOffDevice(
    Dehumidifier,
    DehumidifierEndpoint,
    SetDehumidifierOnCommand,
  );
});

test('fan exposes state and on/off commands', async () => {
  await expectOnOffDevice(Fan, FanEndpoint, SetFanOnCommand);
});

type OnOffDevice = Device & {
  readonly on: boolean | undefined;
  turnOn(): void;
  turnOff(): void;
};

type OnOffEndpointConnection<TCommand extends Command> =
  EndpointConnection<TCommand> & {
    readonly on: boolean | undefined;
  };

async function expectOnOffDevice<
  TCommand extends Command,
  TDevice extends OnOffDevice,
  TEndpoint extends Endpoint<TCommand, OnOffEndpointConnection<TCommand>>,
>(
  DeviceConstructor: DeviceConstructor<TDevice>,
  EndpointConstructor: new (name?: string) => TEndpoint,
  CommandConstructor: new (value: boolean) => TCommand,
): Promise<void> {
  const entry = new DeviceEntry('device');
  const device = entry.createInstance(DeviceConstructor);
  const endpoint = entry.getEndpoint();

  expect(device.on).toBeUndefined();
  expect(device.online).toBe(false);
  expect(endpoint).toBeInstanceOf(EndpointConstructor);

  if (!(endpoint instanceof EndpointConstructor)) {
    throw new Error('Expected on/off endpoint was not created.');
  }

  const connection = new TestOnOffEndpointConnection<TCommand>(false);

  endpoint.bindConnection(connection);
  expect(device.on).toBe(false);
  expect(device.online).toBe(true);

  device.turnOn();
  await flushMicrotasks();
  device.turnOff();
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new CommandConstructor(true),
    new CommandConstructor(false),
  ]);
}

class TestOnOffEndpointConnection<
  TCommand extends Command,
> implements OnOffEndpointConnection<TCommand> {
  readonly online = true;

  readonly commands: TCommand[] = [];

  constructor(readonly on: boolean | undefined) {}

  async processCommand(command: TCommand): Promise<void> {
    this.commands.push(command);
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
