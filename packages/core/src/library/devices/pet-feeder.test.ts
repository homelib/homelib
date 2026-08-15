import {DeviceEntry} from '../device.js';
import type {CommandExecution} from '../endpoint.js';

import {
  DispensePetFoodCommand,
  PetFeeder,
  PetFeederEndpoint,
  type PetFeederEndpointCommand,
  type PetFeederEndpointConnection,
} from './pet-feeder.js';

test('exposes pet feeder state and chains commands', async () => {
  const entry = new DeviceEntry('feeder');
  const feeder = entry.createInstance(PetFeeder);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof PetFeederEndpoint)) {
    throw new TypeError('Expected a pet feeder endpoint.');
  }

  expect(feeder.foodLevel).toBeUndefined();
  expect(feeder.bowlFoodWeight).toBeUndefined();

  const connection = new TestPetFeederEndpointConnection();
  endpoint.bindConnection(connection);

  expect(feeder.ready).toBe(true);
  expect(feeder.foodLevel).toBe('low');
  expect(feeder.bowlFoodWeight).toBe(0);
  expect(feeder.dispense(10)).toBe(feeder);
  await flushMicrotasks();
  expect(endpoint.dispense(20)).toBe(endpoint);
  await flushMicrotasks();
  expect(connection.commands).toEqual([
    new DispensePetFoodCommand(10),
    new DispensePetFoodCommand(20),
  ]);
});

test('requires a positive whole portion count and never supersedes dispensing', () => {
  for (const value of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => new DispensePetFoodCommand(value)).toThrow(RangeError);
  }

  const first = new DispensePetFoodCommand(10);
  const second = new DispensePetFoodCommand(10);

  expect(first.supersedes(second)).toBe(false);
  expect(second.supersedes(first)).toBe(false);
  expect(first.toLogString()).toBe('dispense portions=10');
});

class TestPetFeederEndpointConnection implements PetFeederEndpointConnection {
  readonly ready = true;

  readonly stateRevision = 0;

  readonly foodLevel = 'low' as const;

  readonly bowlFoodWeight = 0;

  readonly commands: PetFeederEndpointCommand[] = [];

  prepareCommand(command: PetFeederEndpointCommand): CommandExecution {
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
