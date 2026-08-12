import {DeviceEntry} from '../device.js';

import {
  Fan,
  FanEndpoint,
  type FanEndpointCommand,
  type FanEndpointConnection,
  SetFanHorizontalSwingCommand,
  SetFanOnCommand,
  SetFanSpeedCommand,
  SetFanWindModeCommand,
} from './fan.js';

test('fan commands support chaining', () => {
  const {fan, endpoint} = createFan();

  expect(
    fan
      .turnOn()
      .setWindMode('natural')
      .setSpeed(0.5)
      .setHorizontalSwing(true)
      .turnOff(),
  ).toBe(fan);
  expect(
    endpoint
      .turnOn()
      .setWindMode('normal')
      .setSpeed(0.6)
      .setHorizontalSwing(false)
      .turnOff(),
  ).toBe(endpoint);
  expect(fan.setSpeed(0)).toBe(fan);
  expect(endpoint.setSpeed(0)).toBe(endpoint);
});

test('fan ensureOn queues turn-on only when needed', async () => {
  const deviceCase = createFan();
  const deviceConnection = new TestFanEndpointConnection(false);
  deviceCase.endpoint.bindConnection(deviceConnection);

  expect(
    deviceCase.fan
      .ensureOn()
      .setWindMode('normal')
      .setSpeed(0.5)
      .setHorizontalSwing(false),
  ).toBe(deviceCase.fan);
  await flushMicrotasks();
  expect(deviceConnection.commands).toEqual([
    new SetFanOnCommand(true),
    new SetFanWindModeCommand('normal'),
    new SetFanSpeedCommand(0.5),
    new SetFanHorizontalSwingCommand(false),
  ]);

  const endpointCase = createFan();
  const endpointConnection = new TestFanEndpointConnection(false);
  endpointCase.endpoint.bindConnection(endpointConnection);

  expect(endpointCase.endpoint.ensureOn()).toBe(endpointCase.endpoint);
  await flushMicrotasks();
  expect(endpointConnection.commands).toEqual([new SetFanOnCommand(true)]);

  const onCase = createFan();
  const onConnection = new TestFanEndpointConnection(true);
  onCase.endpoint.bindConnection(onConnection);

  expect(onCase.fan.ensureOn()).toBe(onCase.fan);
  expect(onCase.endpoint.ensureOn()).toBe(onCase.endpoint);
  await flushMicrotasks();
  expect(onConnection.commands).toEqual([]);
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

  readonly windMode = 'natural';

  readonly speed = 0.5;

  readonly horizontalSwing = true;

  readonly commands: FanEndpointCommand[] = [];

  constructor(readonly on: boolean) {}

  async processCommand(command: FanEndpointCommand): Promise<void> {
    this.commands.push(command);
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
