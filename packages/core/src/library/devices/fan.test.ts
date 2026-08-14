import {DeviceEntry} from '../device.js';
import type {CommandExecution} from '../endpoint.js';

import {
  Fan,
  FanEndpoint,
  type FanEndpointCommand,
  type FanEndpointConnection,
  SetFanHorizontalSwingCommand,
  SetFanModeCommand,
  SetFanOnCommand,
  SetFanSpeedCommand,
} from './fan.js';

test('fan commands support chaining', () => {
  const {fan, endpoint} = createFan();

  expect(
    fan
      .turnOn()
      .setMode('natural')
      .setSpeed(0.5)
      .setHorizontalSwing(true)
      .turnOff(),
  ).toBe(fan);
  expect(
    endpoint
      .turnOn()
      .setMode('normal')
      .setSpeed(0.6)
      .setHorizontalSwing(false)
      .turnOff(),
  ).toBe(endpoint);
  expect(fan.setSpeed(0)).toBe(fan);
  expect(endpoint.setSpeed(0)).toBe(endpoint);
});

test('fan turnOn queues turn-on for devices and endpoints', async () => {
  const deviceCase = createFan();
  const deviceConnection = new TestFanEndpointConnection(false);
  deviceCase.endpoint.bindConnection(deviceConnection);

  expect(
    deviceCase.fan
      .turnOn()
      .setMode('normal')
      .setSpeed(0.5)
      .setHorizontalSwing(false),
  ).toBe(deviceCase.fan);
  await flushMicrotasks();
  expect(deviceConnection.commands).toEqual([
    new SetFanOnCommand(true),
    new SetFanModeCommand('normal'),
    new SetFanSpeedCommand(0.5),
    new SetFanHorizontalSwingCommand(false),
  ]);

  const endpointCase = createFan();
  const endpointConnection = new TestFanEndpointConnection(false);
  endpointCase.endpoint.bindConnection(endpointConnection);

  expect(endpointCase.endpoint.turnOn()).toBe(endpointCase.endpoint);
  await flushMicrotasks();
  expect(endpointConnection.commands).toEqual([new SetFanOnCommand(true)]);
});

function createFan(): {fan: Fan; endpoint: FanEndpoint} {
  const entry = new DeviceEntry('fan');
  const fan = entry.createInstance(Fan);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof FanEndpoint)) {
    throw new Error('Expected fan endpoint was not created.');
  }

  return {fan, endpoint};
}

class TestFanEndpointConnection implements FanEndpointConnection {
  readonly ready = true;

  readonly stateRevision = 0;

  readonly mode = 'natural';

  readonly speed = 0.5;

  readonly horizontalSwing = true;

  readonly commands: FanEndpointCommand[] = [];

  constructor(readonly on: boolean) {}

  prepareCommand(command: FanEndpointCommand): CommandExecution {
    return {
      execute: async () => {
        this.commands.push(command);
      },
    };
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
