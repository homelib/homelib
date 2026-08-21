import {DeviceEntry} from '../../device.js';
import {
  Light,
  LightEndpoint,
  type LightEndpointCommand,
  type LightEndpointConnection,
  SetLightBrightnessCommand,
  SetLightColorTemperatureCommand,
  SetLightOnCommand,
} from '../../devices/light.js';
import type {CommandExecution} from '../../endpoint.js';

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

test('light turnOn queues turn-on for devices and endpoints', async () => {
  const deviceCase = createLight();
  const deviceConnection = new TestLightEndpointConnection(false);
  deviceCase.endpoint.bindConnection(deviceConnection);

  expect(
    deviceCase.light.turnOn().setBrightness(0.5).setColorTemperature(3_000),
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

  expect(endpointCase.endpoint.turnOn()).toBe(endpointCase.endpoint);
  await flushMicrotasks();
  expect(endpointConnection.commands).toEqual([new SetLightOnCommand(true)]);
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

  readonly stateRevision = 0;

  readonly brightness = 0.5;

  readonly colorTemperature = 3_000;

  readonly commands: LightEndpointCommand[] = [];

  constructor(readonly on: boolean) {}

  prepareCommand(command: LightEndpointCommand): CommandExecution {
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
