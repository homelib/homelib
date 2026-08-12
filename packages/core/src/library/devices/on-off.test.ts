import {action, autorun, observable} from 'mobx';

import {Temperature} from '../atomics/index.js';
import type {Command} from '../command.js';
import {type Device, type DeviceConstructor, DeviceEntry} from '../device.js';
import type {EndpointConnection} from '../endpoint.js';
import {setEndpointLogTarget} from '../log.js';

import {
  AirConditioner,
  AirConditionerEndpoint,
  type AirConditionerEndpointCommand,
  type AirConditionerEndpointConnection,
  SetAirConditionerModeCommand,
  SetAirConditionerOnCommand,
  SetAirConditionerTargetHumidityCommand,
  SetAirConditionerTargetTemperatureCommand,
} from './air-conditioner.js';
import {
  Dehumidifier,
  DehumidifierEndpoint,
  type DehumidifierEndpointCommand,
  type DehumidifierEndpointConnection,
  SetDehumidifierModeCommand,
  SetDehumidifierOnCommand,
  SetDehumidifierTargetHumidityCommand,
} from './dehumidifier.js';
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

test('air conditioner exposes state and on/off commands', async () => {
  await expectOnOffDevice(
    AirConditioner,
    entry => {
      const endpoint = entry.getEndpoint();
      const connection = new TestAirConditionerEndpointConnection();

      expect(endpoint).toBeInstanceOf(AirConditionerEndpoint);

      if (!(endpoint instanceof AirConditionerEndpoint)) {
        throw new Error('Expected air conditioner endpoint was not created.');
      }

      endpoint.bindConnection(connection);
      connection.initialize(
        false,
        undefined,
        undefined,
        undefined,
        Temperature.fromCelsius(20),
        0.5,
      );

      return connection;
    },
    SetAirConditionerOnCommand,
  );
});

test('dehumidifier exposes state and on/off commands', async () => {
  await expectOnOffDevice(
    Dehumidifier,
    entry => {
      const endpoint = entry.getEndpoint();
      const connection = new TestDehumidifierEndpointConnection();

      expect(endpoint).toBeInstanceOf(DehumidifierEndpoint);

      if (!(endpoint instanceof DehumidifierEndpoint)) {
        throw new Error('Expected dehumidifier endpoint was not created.');
      }

      endpoint.bindConnection(connection);
      connection.initialize(
        false,
        undefined,
        undefined,
        Temperature.fromCelsius(20),
        0.5,
      );

      return connection;
    },
    SetDehumidifierOnCommand,
  );
});

test('fan exposes state and on/off commands', async () => {
  await expectOnOffDevice(
    Fan,
    entry => {
      const endpoint = entry.getEndpoint();
      const connection = new TestFanEndpointConnection(
        false,
        undefined,
        undefined,
        undefined,
      );

      expect(endpoint).toBeInstanceOf(FanEndpoint);

      if (!(endpoint instanceof FanEndpoint)) {
        throw new Error('Expected fan endpoint was not created.');
      }

      endpoint.bindConnection(connection);

      return connection;
    },
    SetFanOnCommand,
  );
});

test('air conditioner exposes mode, targets, and commands', async () => {
  const entry = new DeviceEntry('air conditioner');
  const airConditioner = entry.createInstance(AirConditioner);
  const endpoint = entry.getEndpoint();
  const targetTemperature = Temperature.fromCelsius(21.5);
  const temperature = Temperature.fromCelsius(23.25);

  expect(airConditioner.on).toBe(false);
  expect(airConditioner.mode).toBeUndefined();
  expect(airConditioner.targetTemperature).toBeUndefined();
  expect(airConditioner.targetHumidity).toBeUndefined();
  expect(airConditioner.temperature).toBeUndefined();
  expect(airConditioner.humidity).toBeUndefined();

  if (!(endpoint instanceof AirConditionerEndpoint)) {
    throw new Error('Expected air conditioner endpoint was not created.');
  }

  const connection = new TestAirConditionerEndpointConnection();

  endpoint.bindConnection(connection);
  connection.initialize(
    true,
    'heat',
    targetTemperature,
    0.48,
    temperature,
    0.52,
  );

  expect(airConditioner.on).toBe(true);
  expect(airConditioner.mode).toBe('heat');
  expect(airConditioner.targetTemperature).toBe(targetTemperature);
  expect(airConditioner.targetHumidity).toBe(0.48);
  expect(endpoint.targetHumidity).toBe(0.48);
  expect(airConditioner.temperature).toBe(temperature);
  expect(airConditioner.humidity).toBe(0.52);
  expect(endpoint.temperature).toBe(temperature);
  expect(endpoint.humidity).toBe(0.52);

  airConditioner.setMode('cool');
  const nextTargetTemperature = Temperature.fromCelsius(24);
  airConditioner.setTargetTemperature(nextTargetTemperature);
  airConditioner.setTargetHumidity(0.6);
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new SetAirConditionerModeCommand('cool'),
    new SetAirConditionerTargetTemperatureCommand(nextTargetTemperature),
    new SetAirConditionerTargetHumidityCommand(0.6),
  ]);
});

test('dehumidifier exposes mode, target humidity, and commands', async () => {
  const entry = new DeviceEntry('dehumidifier');
  const dehumidifier = entry.createInstance(Dehumidifier);
  const endpoint = entry.getEndpoint();
  const temperature = Temperature.fromCelsius(24.5);

  expect(dehumidifier.on).toBe(false);
  expect(dehumidifier.mode).toBeUndefined();
  expect(dehumidifier.targetHumidity).toBeUndefined();
  expect(dehumidifier.temperature).toBeUndefined();
  expect(dehumidifier.humidity).toBeUndefined();

  if (!(endpoint instanceof DehumidifierEndpoint)) {
    throw new Error('Expected dehumidifier endpoint was not created.');
  }

  const connection = new TestDehumidifierEndpointConnection();

  endpoint.bindConnection(connection);
  connection.initialize(true, 'laundry', 0.45, temperature, 0.57);

  expect(dehumidifier.on).toBe(true);
  expect(dehumidifier.mode).toBe('laundry');
  expect(dehumidifier.targetHumidity).toBe(0.45);
  expect(dehumidifier.temperature).toBe(temperature);
  expect(dehumidifier.humidity).toBe(0.57);
  expect(endpoint.temperature).toBe(temperature);
  expect(endpoint.humidity).toBe(0.57);

  dehumidifier.setMode('sleep');
  dehumidifier.setTargetHumidity(0.6);
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new SetDehumidifierModeCommand('sleep'),
    new SetDehumidifierTargetHumidityCommand(0.6),
  ]);
});

test('publishes sensor state and readiness atomically', () => {
  const entry = new DeviceEntry('air conditioner');
  const airConditioner = entry.createInstance(AirConditioner);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof AirConditionerEndpoint)) {
    throw new Error('Expected air conditioner endpoint was not created.');
  }

  const connection = new TestAirConditionerEndpointConnection();
  const observedStates: Array<{
    ready: boolean;
    temperature: number | undefined;
    humidity: number | undefined;
  }> = [];
  const dispose = autorun(() => {
    observedStates.push({
      ready: airConditioner.ready,
      temperature: airConditioner.temperature?.kelvin,
      humidity: airConditioner.humidity,
    });
  });

  try {
    endpoint.bindConnection(connection);
    connection.initialize(
      true,
      'cool',
      Temperature.fromCelsius(24),
      0.48,
      Temperature.fromCelsius(23.25),
      0.52,
    );

    expect(observedStates).toEqual([
      {ready: false, temperature: undefined, humidity: undefined},
      {ready: false, temperature: 0, humidity: 0},
      {
        ready: true,
        temperature: Temperature.fromCelsius(23.25).kelvin,
        humidity: 0.52,
      },
    ]);
    expect(
      observedStates.some(
        state => state.ready && state.temperature === 0 && state.humidity === 0,
      ),
    ).toBe(false);
  } finally {
    dispose();
  }
});

test('fan exposes wind mode, speed, horizontal swing, and commands', async () => {
  const entry = new DeviceEntry('fan');
  const fan = entry.createInstance(Fan);
  const endpoint = entry.getEndpoint();

  expect(fan.on).toBe(false);
  expect(fan.windMode).toBeUndefined();
  expect(fan.speed).toBeUndefined();
  expect(fan.horizontalSwing).toBeUndefined();

  if (!(endpoint instanceof FanEndpoint)) {
    throw new Error('Expected fan endpoint was not created.');
  }

  const connection = new TestFanEndpointConnection(true, 'natural', 0.4, true);

  endpoint.bindConnection(connection);

  expect(fan.on).toBe(true);
  expect(fan.windMode).toBe('natural');
  expect(fan.speed).toBe(0.4);
  expect(fan.horizontalSwing).toBe(true);

  fan.setWindMode('normal');
  fan.setSpeed(0.8);
  fan.setHorizontalSwing(false);
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new SetFanWindModeCommand('normal'),
    new SetFanSpeedCommand(0.8),
    new SetFanHorizontalSwingCommand(false),
  ]);
});

test('setting fan speed to zero enqueues off and supersedes pending on', async () => {
  const entry = new DeviceEntry('fan');
  const fan = entry.createInstance(Fan);
  const endpoint = entry.getEndpoint();

  fan.turnOn();
  fan.setSpeed(0);

  if (!(endpoint instanceof FanEndpoint)) {
    throw new Error('Expected fan endpoint was not created.');
  }

  const connection = new TestFanEndpointConnection(
    false,
    undefined,
    undefined,
    undefined,
  );

  endpoint.bindConnection(connection);
  await flushMicrotasks();

  expect(connection.commands).toEqual([new SetFanOnCommand(false)]);
});

test.each([Number.MIN_VALUE, 0.5, 1])(
  'accepts normalized fan speed %p',
  value => {
    expect(new SetFanSpeedCommand(value).value).toBe(value);
  },
);

test.each([Number.NaN, Number.NEGATIVE_INFINITY, -0.1, 0, 1.1, Infinity])(
  'rejects invalid fan speed %p',
  value => {
    expect(() => new SetFanSpeedCommand(value)).toThrow(RangeError);
  },
);

test.each([0, 0.5, 1])('accepts target humidity %p', value => {
  expect(new SetDehumidifierTargetHumidityCommand(value).value).toBe(value);
});

test.each([0, 0.5, 1])('accepts air conditioner target humidity %p', value => {
  expect(new SetAirConditionerTargetHumidityCommand(value).value).toBe(value);
});

test.each([Number.NaN, Number.NEGATIVE_INFINITY, -0.1, 1.1, Infinity])(
  'rejects invalid target humidity %p',
  value => {
    expect(() => new SetDehumidifierTargetHumidityCommand(value)).toThrow(
      RangeError,
    );
  },
);

test.each([Number.NaN, Number.NEGATIVE_INFINITY, -0.1, 1.1, Infinity])(
  'rejects invalid air conditioner target humidity %p',
  value => {
    expect(() => new SetAirConditionerTargetHumidityCommand(value)).toThrow(
      RangeError,
    );

    const airConditioner = new DeviceEntry('air conditioner').createInstance(
      AirConditioner,
    );

    expect(() => airConditioner.setTargetHumidity(value)).toThrow(RangeError);
  },
);

test('new device commands only supersede commands of the same class', () => {
  const airConditionerMode = new SetAirConditionerModeCommand('cool');
  const airConditionerTemperature =
    new SetAirConditionerTargetTemperatureCommand(Temperature.fromCelsius(24));
  const airConditionerHumidity = new SetAirConditionerTargetHumidityCommand(
    0.5,
  );
  const dehumidifierMode = new SetDehumidifierModeCommand('auto');
  const dehumidifierHumidity = new SetDehumidifierTargetHumidityCommand(0.5);
  const fanWindMode = new SetFanWindModeCommand('normal');
  const fanSpeed = new SetFanSpeedCommand(0.5);
  const fanHorizontalSwing = new SetFanHorizontalSwingCommand(true);

  expect(
    airConditionerMode.supersedes(new SetAirConditionerModeCommand('dry')),
  ).toBe(true);
  expect(airConditionerMode.supersedes(airConditionerTemperature)).toBe(false);
  expect(airConditionerMode.supersedes(airConditionerHumidity)).toBe(false);
  expect(
    airConditionerTemperature.supersedes(
      new SetAirConditionerTargetTemperatureCommand(
        Temperature.fromCelsius(25),
      ),
    ),
  ).toBe(true);
  expect(airConditionerTemperature.supersedes(airConditionerHumidity)).toBe(
    false,
  );
  expect(
    airConditionerHumidity.supersedes(
      new SetAirConditionerTargetHumidityCommand(0.6),
    ),
  ).toBe(true);
  expect(airConditionerHumidity.supersedes(airConditionerTemperature)).toBe(
    false,
  );
  expect(
    dehumidifierMode.supersedes(new SetDehumidifierModeCommand('sleep')),
  ).toBe(true);
  expect(dehumidifierMode.supersedes(dehumidifierHumidity)).toBe(false);
  expect(
    dehumidifierHumidity.supersedes(
      new SetDehumidifierTargetHumidityCommand(0.6),
    ),
  ).toBe(true);
  expect(fanWindMode.supersedes(new SetFanWindModeCommand('natural'))).toBe(
    true,
  );
  expect(fanWindMode.supersedes(fanSpeed)).toBe(false);
  expect(fanSpeed.supersedes(new SetFanSpeedCommand(0.6))).toBe(true);
  expect(fanSpeed.supersedes(fanHorizontalSwing)).toBe(false);
  expect(
    fanHorizontalSwing.supersedes(new SetFanHorizontalSwingCommand(false)),
  ).toBe(true);
});

test('new device commands have semantic log strings', () => {
  expect(new SetAirConditionerModeCommand('cool').toLogString()).toBe(
    'set mode=cool',
  );
  expect(
    new SetAirConditionerTargetTemperatureCommand(
      Temperature.fromCelsius(24),
    ).toLogString(),
  ).toBe('set targetTemperatureCelsius=24');
  expect(new SetAirConditionerTargetHumidityCommand(0.5).toLogString()).toBe(
    'set targetHumidity=0.5',
  );
  expect(new SetDehumidifierModeCommand('laundry').toLogString()).toBe(
    'set mode=laundry',
  );
  expect(new SetDehumidifierTargetHumidityCommand(0.5).toLogString()).toBe(
    'set targetHumidity=0.5',
  );
  expect(new SetFanWindModeCommand('natural').toLogString()).toBe(
    'set windMode=natural',
  );
  expect(new SetFanSpeedCommand(0.5).toLogString()).toBe('set speed=0.5');
  expect(new SetFanHorizontalSwingCommand(true).toLogString()).toBe(
    'set horizontalSwing=true',
  );
});

test('air conditioner logs temperature and humidity state', () => {
  const entry = new DeviceEntry('air conditioner');
  entry.createInstance(AirConditioner);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof AirConditionerEndpoint)) {
    throw new Error('Expected air conditioner endpoint was not created.');
  }

  const logMessages: string[] = [];
  const originalInfo = console.info;

  try {
    console.info = message => logMessages.push(message);
    setEndpointLogTarget(endpoint, {
      scopePath: ['home'],
      deviceName: 'air conditioner',
      endpointName: '',
    });
    const connection = new TestAirConditionerEndpointConnection();
    endpoint.bindConnection(connection);
    connection.initialize(
      true,
      'heat',
      Temperature.fromCelsius(21.5),
      0.48,
      Temperature.fromCelsius(23.25),
      0.52,
    );

    expect(logMessages).toEqual([
      '[homelib] home · device air conditioner state ready=false',
      '[homelib] home · device air conditioner state ready=true on=true mode="heat" targetTemperatureCelsius=21.5 targetHumidity=0.48 temperatureCelsius=23.25 humidity=0.52',
    ]);
  } finally {
    console.info = originalInfo;
  }
});

test('dehumidifier logs temperature and humidity state', () => {
  const entry = new DeviceEntry('dehumidifier');
  entry.createInstance(Dehumidifier);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof DehumidifierEndpoint)) {
    throw new Error('Expected dehumidifier endpoint was not created.');
  }

  const logMessages: string[] = [];
  const originalInfo = console.info;

  try {
    console.info = message => logMessages.push(message);
    setEndpointLogTarget(endpoint, {
      scopePath: ['home'],
      deviceName: 'dehumidifier',
      endpointName: '',
    });
    const connection = new TestDehumidifierEndpointConnection();
    endpoint.bindConnection(connection);
    connection.initialize(
      true,
      'laundry',
      0.45,
      Temperature.fromCelsius(24.5),
      0.57,
    );

    expect(logMessages).toEqual([
      '[homelib] home · device dehumidifier state ready=false',
      '[homelib] home · device dehumidifier state ready=true on=true mode="laundry" targetHumidity=0.45 temperatureCelsius=24.5 humidity=0.57',
    ]);
  } finally {
    console.info = originalInfo;
  }
});

type OnOffDevice = Device & {
  readonly on: boolean;
  turnOn(): void;
  turnOff(): void;
};

type RecordedOnOffEndpointConnection = {
  readonly on: boolean;
  readonly commands: readonly Command[];
};

async function expectOnOffDevice<TDevice extends OnOffDevice>(
  DeviceConstructor: DeviceConstructor<TDevice>,
  bindConnection: (entry: DeviceEntry) => RecordedOnOffEndpointConnection,
  CommandConstructor: new (value: boolean) => Command,
): Promise<void> {
  const entry = new DeviceEntry('device');
  const device = entry.createInstance(DeviceConstructor);

  expect(device.on).toBe(false);
  expect(device.ready).toBe(false);

  const connection = bindConnection(entry);

  expect(device.on).toBe(false);
  expect(device.ready).toBe(true);

  device.turnOn();
  await flushMicrotasks();
  device.turnOff();
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new CommandConstructor(true),
    new CommandConstructor(false),
  ]);
}

class BaseTestOnOffEndpointConnection<
  TCommand extends Command,
> implements EndpointConnection<TCommand> {
  readonly ready = true;

  readonly commands: TCommand[] = [];

  constructor(readonly on: boolean) {}

  async processCommand(command: TCommand): Promise<void> {
    this.commands.push(command);
  }
}

abstract class BaseTestSensorEndpointConnection<
  TCommand extends Command,
> implements EndpointConnection<TCommand> {
  @observable accessor ready = false;

  @observable accessor on = false;

  readonly commands: TCommand[] = [];

  async processCommand(command: TCommand): Promise<void> {
    this.commands.push(command);
  }
}

class TestAirConditionerEndpointConnection
  extends BaseTestSensorEndpointConnection<AirConditionerEndpointCommand>
  implements AirConditionerEndpointConnection
{
  @observable accessor mode: AirConditionerEndpointConnection['mode'];

  @observable.ref
  accessor targetTemperature: AirConditionerEndpointConnection['targetTemperature'];

  @observable accessor targetHumidity: number | undefined;

  @observable.ref
  accessor temperature: AirConditionerEndpointConnection['temperature'] =
    Temperature.fromKelvin(0);

  @observable accessor humidity: number | undefined = 0;

  @action
  initialize(
    on: boolean,
    mode: AirConditionerEndpointConnection['mode'],
    targetTemperature: AirConditionerEndpointConnection['targetTemperature'],
    targetHumidity: number | undefined,
    temperature: AirConditionerEndpointConnection['temperature'],
    humidity: number | undefined,
  ): void {
    this.on = on;
    this.mode = mode;
    this.targetTemperature = targetTemperature;
    this.targetHumidity = targetHumidity;
    this.temperature = temperature;
    this.humidity = humidity;
    this.ready = true;
  }
}

class TestDehumidifierEndpointConnection
  extends BaseTestSensorEndpointConnection<DehumidifierEndpointCommand>
  implements DehumidifierEndpointConnection
{
  @observable accessor mode: DehumidifierEndpointConnection['mode'];

  @observable accessor targetHumidity: number | undefined;

  @observable.ref
  accessor temperature: DehumidifierEndpointConnection['temperature'] =
    Temperature.fromKelvin(0);

  @observable accessor humidity: number | undefined = 0;

  @action
  initialize(
    on: boolean,
    mode: DehumidifierEndpointConnection['mode'],
    targetHumidity: number | undefined,
    temperature: DehumidifierEndpointConnection['temperature'],
    humidity: number | undefined,
  ): void {
    this.on = on;
    this.mode = mode;
    this.targetHumidity = targetHumidity;
    this.temperature = temperature;
    this.humidity = humidity;
    this.ready = true;
  }
}

class TestFanEndpointConnection
  extends BaseTestOnOffEndpointConnection<FanEndpointCommand>
  implements FanEndpointConnection
{
  constructor(
    on: boolean,
    readonly windMode: FanEndpointConnection['windMode'],
    readonly speed: number | undefined,
    readonly horizontalSwing: boolean | undefined,
  ) {
    super(on);
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
