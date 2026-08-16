import {Temperature} from '../atomics/index.js';
import {DeviceEntry} from '../device.js';
import type {CommandExecution} from '../endpoint.js';

import {
  AirConditioner,
  AirConditionerEndpoint,
  type AirConditionerEndpointCommand,
  type AirConditionerEndpointConnection,
  SetAirConditionerFanSpeedCommand,
  SetAirConditionerModeCommand,
  SetAirConditionerOnCommand,
  SetAirConditionerTargetHumidityCommand,
  SetAirConditionerTargetTemperatureCommand,
} from './air-conditioner.js';

test('commands return their receiver', () => {
  const {airConditioner, endpoint} = createAirConditioner();
  const targetTemperature = Temperature.fromCelsius(24);

  expect(airConditioner.turnOn()).toBe(airConditioner);
  expect(airConditioner.setMode('cool')).toBe(airConditioner);
  expect(airConditioner.setFanSpeed('auto')).toBe(airConditioner);
  expect(airConditioner.setTargetTemperature(targetTemperature)).toBe(
    airConditioner,
  );
  expect(airConditioner.setTargetHumidity(0.5)).toBe(airConditioner);
  expect(airConditioner.turnOff()).toBe(airConditioner);

  expect(endpoint.turnOn()).toBe(endpoint);
  expect(endpoint.setMode('dry')).toBe(endpoint);
  expect(endpoint.setFanSpeed(0.5)).toBe(endpoint);
  expect(endpoint.setTargetTemperature(targetTemperature)).toBe(endpoint);
  expect(endpoint.setTargetHumidity(0.6)).toBe(endpoint);
  expect(endpoint.turnOff()).toBe(endpoint);
});

test('turnOn enqueues on before chained setters when off', async () => {
  const {airConditioner, endpoint} = createAirConditioner();
  const connection = new TestAirConditionerEndpointConnection(false);
  const targetTemperature = Temperature.fromCelsius(24);

  endpoint.bindConnection(connection);

  airConditioner
    .turnOn()
    .setMode('cool')
    .setFanSpeed(0)
    .setTargetTemperature(targetTemperature)
    .setTargetHumidity(0.5);
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new SetAirConditionerOnCommand(true),
    new SetAirConditionerModeCommand('cool'),
    new SetAirConditionerFanSpeedCommand(0),
    new SetAirConditionerTargetTemperatureCommand(targetTemperature),
    new SetAirConditionerTargetHumidityCommand(0.5),
  ]);
});

function createAirConditioner(): {
  airConditioner: AirConditioner;
  endpoint: AirConditionerEndpoint;
} {
  const entry = new DeviceEntry('air conditioner');
  const airConditioner = entry.createInstance(AirConditioner);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof AirConditionerEndpoint)) {
    throw new Error('Expected air conditioner endpoint was not created.');
  }

  return {airConditioner, endpoint};
}

class TestAirConditionerEndpointConnection implements AirConditionerEndpointConnection {
  readonly ready = true;

  readonly stateRevision = 0;

  readonly mode = undefined;

  readonly fanSpeed = undefined;

  readonly targetTemperature = undefined;

  readonly targetRelativeHumidity = undefined;

  readonly temperature = undefined;

  readonly relativeHumidity = undefined;

  readonly commands: AirConditionerEndpointCommand[] = [];

  constructor(readonly on: boolean) {}

  prepareCommand(command: AirConditionerEndpointCommand): CommandExecution {
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
