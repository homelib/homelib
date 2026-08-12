import {DeviceEntry} from '../device.js';

import {
  Light,
  LightEndpoint,
  type LightEndpointCommand,
  type LightEndpointConnection,
  SetLightBrightnessCommand,
  SetLightColorTemperatureCommand,
  SetLightOnCommand,
} from './light.js';

test('light commands support chaining', () => {
  const {light, endpoint} = createLight();

  expect(
    light.turnOn().setBrightness(0.5).setColorTemperature(3_000).turnOff(),
  ).toBe(light);
  expect(
    endpoint.turnOn().setBrightness(0.6).setColorTemperature(4_000).turnOff(),
  ).toBe(endpoint);
  expect(light.setBrightness(0)).toBe(light);
  expect(endpoint.setBrightness(0)).toBe(endpoint);
});

test('light ensureOn queues turn-on only when needed', async () => {
  const deviceCase = createLight();
  const deviceConnection = new TestLightEndpointConnection(false);
  deviceCase.endpoint.bindConnection(deviceConnection);

  expect(
    deviceCase.light.ensureOn().setBrightness(0.5).setColorTemperature(3_000),
  ).toBe(deviceCase.light);
  await flushMicrotasks();
  expect(deviceConnection.commands).toEqual([
    new SetLightOnCommand(true),
    new SetLightBrightnessCommand(0.5),
    new SetLightColorTemperatureCommand(3_000),
  ]);

  const endpointCase = createLight();
  const endpointConnection = new TestLightEndpointConnection(false);
  endpointCase.endpoint.bindConnection(endpointConnection);

  expect(endpointCase.endpoint.ensureOn()).toBe(endpointCase.endpoint);
  await flushMicrotasks();
  expect(endpointConnection.commands).toEqual([new SetLightOnCommand(true)]);

  const onCase = createLight();
  const onConnection = new TestLightEndpointConnection(true);
  onCase.endpoint.bindConnection(onConnection);

  expect(onCase.light.ensureOn()).toBe(onCase.light);
  expect(onCase.endpoint.ensureOn()).toBe(onCase.endpoint);
  await flushMicrotasks();
  expect(onConnection.commands).toEqual([]);
});

function createLight(): {light: Light; endpoint: LightEndpoint} {
  const entry = new DeviceEntry('light');
  const light = entry.createInstance(Light);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof LightEndpoint)) {
    throw new Error('Expected light endpoint was not created.');
  }

  return {light, endpoint};
}

class TestLightEndpointConnection implements LightEndpointConnection {
  readonly ready = true;

  readonly brightness = 0.5;

  readonly colorTemperature = 3_000;

  readonly commands: LightEndpointCommand[] = [];

  constructor(readonly on: boolean) {}

  async processCommand(command: LightEndpointCommand): Promise<void> {
    this.commands.push(command);
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
