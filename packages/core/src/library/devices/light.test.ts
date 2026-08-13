import {action, observable} from 'mobx';

import {DeviceEntry} from '../device.js';
import type {CommandExecution} from '../endpoint.js';
import {
  type EndpointStateLogEvent,
  addLogListener,
  setEndpointLogTarget,
} from '../log.js';

import {
  Light,
  LightEndpoint,
  type LightEndpointCommand,
  type LightEndpointConnection,
  SetLightBrightnessCommand,
  SetLightColorTemperatureCommand,
  SetLightOnCommand,
} from './light.js';

test('light exposes state and commands', async () => {
  const entry = new DeviceEntry('light');
  const light = entry.createInstance(Light);
  const endpoint = entry.getEndpoint();

  expect(light.on).toBe(false);
  expect(light.brightness).toBeUndefined();
  expect(light.colorTemperature).toBeUndefined();

  if (!(endpoint instanceof LightEndpoint)) {
    throw new Error('Expected light endpoint was not created.');
  }

  const connection = new TestLightEndpointConnection(true, 0.4, 3000);

  endpoint.bindConnection(connection);
  expect(light.on).toBe(true);
  expect(light.brightness).toBe(0.4);
  expect(light.colorTemperature).toBe(3000);

  light.turnOff();
  light.setBrightness(0.8);
  light.setColorTemperature(4000);
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new SetLightOnCommand(false),
    new SetLightBrightnessCommand(0.8),
    new SetLightColorTemperatureCommand(4000),
  ]);
});

test('setting brightness to zero enqueues off and supersedes pending on', async () => {
  const entry = new DeviceEntry('light');
  const light = entry.createInstance(Light);
  const endpoint = entry.getEndpoint();

  light.turnOn();
  light.setBrightness(0);

  if (!(endpoint instanceof LightEndpoint)) {
    throw new Error('Expected light endpoint was not created.');
  }

  const connection = new TestLightEndpointConnection(false, 0.4, 3000);

  endpoint.bindConnection(connection);
  await flushMicrotasks();

  expect(connection.commands).toEqual([new SetLightOnCommand(false)]);
});

test.each([Number.MIN_VALUE, 0.5, 1])('accepts brightness %p', value => {
  expect(new SetLightBrightnessCommand(value).value).toBe(value);
});

test.each([Number.NaN, Number.NEGATIVE_INFINITY, -0.1, 0, 1.1, Infinity])(
  'rejects invalid brightness %p',
  value => {
    expect(() => new SetLightBrightnessCommand(value)).toThrow(RangeError);
  },
);

test.each([Number.MIN_VALUE, 2700])('accepts color temperature %p', value => {
  expect(new SetLightColorTemperatureCommand(value).value).toBe(value);
});

test.each([Number.NaN, Number.NEGATIVE_INFINITY, -1, 0, Infinity])(
  'rejects invalid color temperature %p',
  value => {
    expect(() => new SetLightColorTemperatureCommand(value)).toThrow(
      RangeError,
    );
  },
);

test('light commands only supersede commands of the same class', () => {
  const on = new SetLightOnCommand(true);
  const brightness = new SetLightBrightnessCommand(0.5);
  const colorTemperature = new SetLightColorTemperatureCommand(3000);

  expect(on.supersedes(new SetLightOnCommand(false))).toBe(true);
  expect(on.supersedes(brightness)).toBe(false);
  expect(brightness.supersedes(new SetLightBrightnessCommand(0.6))).toBe(true);
  expect(brightness.supersedes(colorTemperature)).toBe(false);
  expect(
    colorTemperature.supersedes(new SetLightColorTemperatureCommand(4000)),
  ).toBe(true);
  expect(colorTemperature.supersedes(on)).toBe(false);
});

test('logs an atomic semantic light state update', () => {
  const entry = new DeviceEntry('light');
  entry.createInstance(Light);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof LightEndpoint)) {
    throw new Error('Expected light endpoint was not created.');
  }

  const connection = new ObservableTestLightEndpointConnection();
  const logEvents: EndpointStateLogEvent[] = [];
  const removeLogListener = addLogListener(event => {
    if (event.type === 'endpoint-state') {
      logEvents.push(event);
    }
  });

  try {
    setEndpointLogTarget(endpoint, {
      scopePath: ['home', 'room'],
      deviceName: 'light',
      endpointName: '',
    });
    endpoint.bindConnection(connection);
    connection.initialize(true, 0.4, 3_000);

    expect(logEvents.map(event => event.state)).toEqual([
      {ready: false},
      {ready: true, on: true, brightness: 0.4, colorTemperature: 3000},
    ]);
  } finally {
    removeLogListener();
  }
});

class TestLightEndpointConnection implements LightEndpointConnection {
  readonly ready = true;

  readonly stateRevision = 0;

  readonly commands: LightEndpointCommand[] = [];

  constructor(
    readonly on: boolean,
    readonly brightness: number | undefined,
    readonly colorTemperature: number | undefined,
  ) {}

  prepareCommand(command: LightEndpointCommand): CommandExecution {
    return {
      execute: async () => {
        this.commands.push(command);
      },
    };
  }
}

class ObservableTestLightEndpointConnection implements LightEndpointConnection {
  @observable accessor ready = false;

  @observable accessor stateRevision = 0;

  @observable accessor on = false;

  @observable accessor brightness: number | undefined;

  @observable accessor colorTemperature: number | undefined;

  @action
  initialize(
    on: boolean,
    brightness: number | undefined,
    colorTemperature: number | undefined,
  ): void {
    this.on = on;
    this.brightness = brightness;
    this.colorTemperature = colorTemperature;
    this.stateRevision++;
    this.ready = true;
  }

  prepareCommand(_command: LightEndpointCommand): CommandExecution {
    return {execute: () => Promise.resolve()};
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
