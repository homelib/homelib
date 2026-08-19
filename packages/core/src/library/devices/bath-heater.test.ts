import {Temperature} from '../atomics/index.js';
import {DeviceEntry} from '../device.js';
import type {CommandExecution} from '../endpoint.js';

import {
  BathHeater,
  BathHeaterEndpoint,
  type BathHeaterEndpointCommand,
  type BathHeaterEndpointConnection,
  SetBathHeaterBlowingCommand,
  SetBathHeaterHeatingCommand,
  SetBathHeaterModeCommand,
  SetBathHeaterTargetTemperatureCommand,
  SetBathHeaterVentilatingCommand,
  StopBathHeaterCommand,
} from './bath-heater.js';
import {
  LightEndpoint,
  type LightEndpointCommand,
  type LightEndpointConnection,
  SetLightBrightnessCommand,
  SetLightOnCommand,
} from './light.js';

test('bath heater composes heater and light endpoints', async () => {
  const entry = new DeviceEntry('bath heater');
  const bathHeater = entry.createInstance(BathHeater);
  const endpoint = entry.getEndpoint();
  const lightEndpoint = entry.getEndpoint('light');

  expect(endpoint).toBeInstanceOf(BathHeaterEndpoint);
  expect(lightEndpoint).toBeInstanceOf(LightEndpoint);

  if (!(endpoint instanceof BathHeaterEndpoint)) {
    throw new TypeError('Expected a bath heater endpoint.');
  }

  if (!(lightEndpoint instanceof LightEndpoint)) {
    throw new TypeError('Expected a bath heater light endpoint.');
  }

  const targetTemperature = Temperature.fromCelsius(30);
  const temperature = Temperature.fromCelsius(26);
  const connection = new TestBathHeaterEndpointConnection(
    targetTemperature,
    temperature,
  );
  const lightConnection = new TestLightEndpointConnection();

  endpoint.bindConnection(connection);
  expect(bathHeater.ready).toBe(false);
  lightEndpoint.bindConnection(lightConnection);

  expect(bathHeater.ready).toBe(true);
  expect(bathHeater.mode).toBe('defog');
  expect(bathHeater.heating).toBe(true);
  expect(bathHeater.blowing).toBe(false);
  expect(bathHeater.ventilating).toBe(true);
  expect(bathHeater.targetTemperature).toBe(targetTemperature);
  expect(bathHeater.temperature).toBe(temperature);
  expect(bathHeater.lightOn).toBe(false);
  expect(bathHeater.lightBrightness).toBe(0.8);

  expect(
    bathHeater
      .turnLightOn()
      .setLightBrightness(0.5)
      .setMode('quick-heat')
      .setHeating(false)
      .setBlowing(true)
      .setVentilating(false)
      .setTargetTemperature(Temperature.fromCelsius(32))
      .stop()
      .stop(),
  ).toBe(bathHeater);
  await flushMicrotasks();

  expect(lightConnection.commands).toEqual([
    new SetLightOnCommand(true),
    new SetLightBrightnessCommand(0.5),
  ]);
  expect(connection.commands).toEqual([
    new SetBathHeaterModeCommand('quick-heat'),
    new SetBathHeaterHeatingCommand(false),
    new SetBathHeaterBlowingCommand(true),
    new SetBathHeaterVentilatingCommand(false),
    new SetBathHeaterTargetTemperatureCommand(Temperature.fromCelsius(32)),
    new StopBathHeaterCommand(),
    new StopBathHeaterCommand(),
  ]);
});

test('bath heater mode rejects values outside its domain', () => {
  expect(() => new SetBathHeaterModeCommand('idle' as never)).toThrow(
    TypeError,
  );
});

test('stop commands remain one-shot', () => {
  const first = new StopBathHeaterCommand();
  const second = new StopBathHeaterCommand();

  expect(first.supersedes(second)).toBe(false);
  expect(second.supersedes(first)).toBe(false);
});

class TestBathHeaterEndpointConnection implements BathHeaterEndpointConnection {
  readonly ready = true;

  readonly stateRevision = 0;

  readonly mode = 'defog' as const;

  readonly heating = true;

  readonly blowing = false;

  readonly ventilating = true;

  readonly commands: BathHeaterEndpointCommand[] = [];

  constructor(
    readonly targetTemperature: Temperature,
    readonly temperature: Temperature,
  ) {}

  prepareCommand(command: BathHeaterEndpointCommand): CommandExecution {
    return {
      execute: async () => {
        this.commands.push(command);
      },
    };
  }
}

class TestLightEndpointConnection implements LightEndpointConnection {
  readonly ready = true;

  readonly stateRevision = 0;

  readonly on = false;

  readonly brightness = 0.8;

  readonly colorTemperature: number | undefined;

  readonly commands: LightEndpointCommand[] = [];

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
