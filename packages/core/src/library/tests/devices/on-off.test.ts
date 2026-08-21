import {action, autorun, observable} from 'mobx';

import {Temperature} from '../../atomics/index.js';
import type {Command} from '../../command.js';
import {
  type Device,
  type DeviceConstructor,
  DeviceEntry,
} from '../../device.js';
import {
  AirConditioner,
  AirConditionerEndpoint,
  type AirConditionerEndpointCommand,
  type AirConditionerEndpointConnection,
  type AirConditionerFanSpeed,
  SetAirConditionerFanSpeedCommand,
  SetAirConditionerModeCommand,
  SetAirConditionerOnCommand,
  SetAirConditionerTargetRelativeHumidityCommand,
  SetAirConditionerTargetTemperatureCommand,
} from '../../devices/air-conditioner.js';
import {
  Dehumidifier,
  DehumidifierEndpoint,
  type DehumidifierEndpointCommand,
  type DehumidifierEndpointConnection,
  SetDehumidifierModeCommand,
  SetDehumidifierOnCommand,
  SetDehumidifierTargetRelativeHumidityCommand,
} from '../../devices/dehumidifier.js';
import {
  Fan,
  FanEndpoint,
  type FanEndpointCommand,
  type FanEndpointConnection,
  SetFanHorizontalSwingCommand,
  SetFanModeCommand,
  SetFanOnCommand,
  SetFanSpeedCommand,
} from '../../devices/fan.js';
import type {CommandExecution, EndpointConnection} from '../../endpoint.js';
import {
  type EndpointStateLogEvent,
  addLogListener,
  setEndpointLogTarget,
} from '../../log.js';

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

test('air conditioner exposes mode, fan speed, targets, and commands', async () => {
  const entry = new DeviceEntry('air conditioner');
  const airConditioner = entry.createInstance(AirConditioner);
  const endpoint = entry.getEndpoint();
  const targetTemperature = Temperature.fromCelsius(21.5);
  const temperature = Temperature.fromCelsius(23.25);

  expect(airConditioner.on).toBe(false);
  expect(airConditioner.mode).toBeUndefined();
  expect(airConditioner.fanSpeed).toBeUndefined();
  expect(airConditioner.targetTemperature).toBeUndefined();
  expect(airConditioner.targetRelativeHumidity).toBeUndefined();
  expect(airConditioner.temperature).toBeUndefined();
  expect(airConditioner.relativeHumidity).toBeUndefined();

  if (!(endpoint instanceof AirConditionerEndpoint)) {
    throw new Error('Expected air conditioner endpoint was not created.');
  }

  const connection = new TestAirConditionerEndpointConnection();

  endpoint.bindConnection(connection);
  connection.initialize(
    true,
    'heat',
    'auto',
    targetTemperature,
    0.48,
    temperature,
    0.52,
  );

  expect(airConditioner.on).toBe(true);
  expect(airConditioner.mode).toBe('heat');
  expect(airConditioner.fanSpeed).toBe('auto');
  expect(endpoint.fanSpeed).toBe('auto');
  expect(airConditioner.targetTemperature).toBe(targetTemperature);
  expect(airConditioner.targetRelativeHumidity).toBe(0.48);
  expect(endpoint.targetRelativeHumidity).toBe(0.48);
  expect(airConditioner.temperature).toBe(temperature);
  expect(airConditioner.relativeHumidity).toBe(0.52);
  expect(endpoint.temperature).toBe(temperature);
  expect(endpoint.relativeHumidity).toBe(0.52);

  airConditioner.setMode('cool');
  airConditioner.setFanSpeed(0);
  const nextTargetTemperature = Temperature.fromCelsius(24);
  airConditioner.setTargetTemperature(nextTargetTemperature);
  airConditioner.setTargetRelativeHumidity(0.6);
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new SetAirConditionerModeCommand('cool'),
    new SetAirConditionerFanSpeedCommand(0),
    new SetAirConditionerTargetTemperatureCommand(nextTargetTemperature),
    new SetAirConditionerTargetRelativeHumidityCommand(0.6),
  ]);
});

test('dehumidifier exposes mode, target relative humidity, and commands', async () => {
  const entry = new DeviceEntry('dehumidifier');
  const dehumidifier = entry.createInstance(Dehumidifier);
  const endpoint = entry.getEndpoint();
  const temperature = Temperature.fromCelsius(24.5);

  expect(dehumidifier.on).toBe(false);
  expect(dehumidifier.mode).toBeUndefined();
  expect(dehumidifier.targetRelativeHumidity).toBeUndefined();
  expect(dehumidifier.waterTankFull).toBeUndefined();
  expect(dehumidifier.temperature).toBeUndefined();
  expect(dehumidifier.relativeHumidity).toBeUndefined();

  if (!(endpoint instanceof DehumidifierEndpoint)) {
    throw new Error('Expected dehumidifier endpoint was not created.');
  }

  const connection = new TestDehumidifierEndpointConnection();

  endpoint.bindConnection(connection);
  connection.initialize(true, 'laundry', 0.45, false, temperature, 0.57);

  expect(dehumidifier.on).toBe(true);
  expect(dehumidifier.mode).toBe('laundry');
  expect(dehumidifier.targetRelativeHumidity).toBe(0.45);
  expect(dehumidifier.waterTankFull).toBe(false);
  expect(dehumidifier.temperature).toBe(temperature);
  expect(dehumidifier.relativeHumidity).toBe(0.57);
  expect(endpoint.temperature).toBe(temperature);
  expect(endpoint.relativeHumidity).toBe(0.57);

  dehumidifier.setMode('sleep');
  dehumidifier.setTargetRelativeHumidity(0.6);
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new SetDehumidifierModeCommand('sleep'),
    new SetDehumidifierTargetRelativeHumidityCommand(0.6),
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
    relativeHumidity: number | undefined;
  }> = [];
  const dispose = autorun(() => {
    observedStates.push({
      ready: airConditioner.ready,
      temperature: airConditioner.temperature?.kelvin,
      relativeHumidity: airConditioner.relativeHumidity,
    });
  });

  try {
    endpoint.bindConnection(connection);
    connection.initialize(
      true,
      'cool',
      'auto',
      Temperature.fromCelsius(24),
      0.48,
      Temperature.fromCelsius(23.25),
      0.52,
    );

    expect(observedStates).toEqual([
      {ready: false, temperature: undefined, relativeHumidity: undefined},
      {ready: false, temperature: 0, relativeHumidity: 0},
      {
        ready: true,
        temperature: Temperature.fromCelsius(23.25).kelvin,
        relativeHumidity: 0.52,
      },
    ]);
    expect(
      observedStates.some(
        state =>
          state.ready &&
          state.temperature === 0 &&
          state.relativeHumidity === 0,
      ),
    ).toBe(false);
  } finally {
    dispose();
  }
});

test('fan exposes mode, speed, horizontal swing, and commands', async () => {
  const entry = new DeviceEntry('fan');
  const fan = entry.createInstance(Fan);
  const endpoint = entry.getEndpoint();

  expect(fan.on).toBe(false);
  expect(fan.mode).toBeUndefined();
  expect(fan.speed).toBeUndefined();
  expect(fan.horizontalSwing).toBeUndefined();

  if (!(endpoint instanceof FanEndpoint)) {
    throw new Error('Expected fan endpoint was not created.');
  }

  const connection = new TestFanEndpointConnection(true, 'natural', 0.4, true);

  endpoint.bindConnection(connection);

  expect(fan.on).toBe(true);
  expect(fan.mode).toBe('natural');
  expect(fan.speed).toBe(0.4);
  expect(fan.horizontalSwing).toBe(true);

  fan.setMode('normal');
  fan.setSpeed(0.8);
  fan.setHorizontalSwing(false);
  await flushMicrotasks();

  expect(connection.commands).toEqual([
    new SetFanModeCommand('normal'),
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

test('accepts automatic air conditioner fan speed', () => {
  expect(new SetAirConditionerFanSpeedCommand('auto').value).toBe('auto');
});

test.each([0, Number.MIN_VALUE, 0.5, 1])(
  'accepts normalized air conditioner fan speed %p',
  value => {
    expect(new SetAirConditionerFanSpeedCommand(value).value).toBe(value);
  },
);

test.each([
  Number.NaN,
  Number.NEGATIVE_INFINITY,
  -0.1,
  -Number.MIN_VALUE,
  1.1,
  Infinity,
])('rejects invalid air conditioner fan speed %p', value => {
  expect(() => new SetAirConditionerFanSpeedCommand(value)).toThrow(RangeError);

  const airConditioner = new DeviceEntry('air conditioner').createInstance(
    AirConditioner,
  );

  expect(() => airConditioner.setFanSpeed(value)).toThrow(RangeError);
});

test('rejects unsupported air conditioner fan speed labels at runtime', () => {
  const value = 'low' as unknown as AirConditionerFanSpeed;

  expect(() => new SetAirConditionerFanSpeedCommand(value)).toThrow(TypeError);

  const airConditioner = new DeviceEntry('air conditioner').createInstance(
    AirConditioner,
  );

  expect(() => airConditioner.setFanSpeed(value)).toThrow(TypeError);
});

test.each([Number.NaN, Number.NEGATIVE_INFINITY, -0.1, 0, 1.1, Infinity])(
  'rejects invalid fan speed %p',
  value => {
    expect(() => new SetFanSpeedCommand(value)).toThrow(RangeError);
  },
);

test.each([0, 0.5, 1])(
  'accepts target relative humidity %p',
  relativeHumidity => {
    expect(
      new SetDehumidifierTargetRelativeHumidityCommand(relativeHumidity)
        .relativeHumidity,
    ).toBe(relativeHumidity);
  },
);

test.each([0, 0.5, 1])(
  'accepts air conditioner target relative humidity %p',
  relativeHumidity => {
    expect(
      new SetAirConditionerTargetRelativeHumidityCommand(relativeHumidity)
        .relativeHumidity,
    ).toBe(relativeHumidity);
  },
);

test.each([Number.NaN, Number.NEGATIVE_INFINITY, -0.1, 1.1, Infinity])(
  'rejects invalid target relative humidity %p',
  relativeHumidity => {
    expect(
      () => new SetDehumidifierTargetRelativeHumidityCommand(relativeHumidity),
    ).toThrow(RangeError);
  },
);

test.each([Number.NaN, Number.NEGATIVE_INFINITY, -0.1, 1.1, Infinity])(
  'rejects invalid air conditioner target relative humidity %p',
  relativeHumidity => {
    expect(
      () =>
        new SetAirConditionerTargetRelativeHumidityCommand(relativeHumidity),
    ).toThrow(RangeError);

    const airConditioner = new DeviceEntry('air conditioner').createInstance(
      AirConditioner,
    );

    expect(() =>
      airConditioner.setTargetRelativeHumidity(relativeHumidity),
    ).toThrow(RangeError);
  },
);

test('new device commands only supersede commands of the same class', () => {
  const airConditionerMode = new SetAirConditionerModeCommand('cool');
  const airConditionerFanSpeed = new SetAirConditionerFanSpeedCommand('auto');
  const airConditionerTemperature =
    new SetAirConditionerTargetTemperatureCommand(Temperature.fromCelsius(24));
  const airConditionerTargetRelativeHumidityCommand =
    new SetAirConditionerTargetRelativeHumidityCommand(0.5);
  const dehumidifierMode = new SetDehumidifierModeCommand('auto');
  const dehumidifierTargetRelativeHumidityCommand =
    new SetDehumidifierTargetRelativeHumidityCommand(0.5);
  const fanMode = new SetFanModeCommand('normal');
  const fanSpeed = new SetFanSpeedCommand(0.5);
  const fanHorizontalSwing = new SetFanHorizontalSwingCommand(true);

  expect(
    airConditionerMode.supersedes(new SetAirConditionerModeCommand('dry')),
  ).toBe(true);
  expect(airConditionerMode.supersedes(airConditionerTemperature)).toBe(false);
  expect(airConditionerMode.supersedes(airConditionerFanSpeed)).toBe(false);
  expect(
    airConditionerFanSpeed.supersedes(
      new SetAirConditionerFanSpeedCommand(0.5),
    ),
  ).toBe(true);
  expect(airConditionerFanSpeed.supersedes(airConditionerMode)).toBe(false);
  expect(
    airConditionerMode.supersedes(airConditionerTargetRelativeHumidityCommand),
  ).toBe(false);
  expect(
    airConditionerTemperature.supersedes(
      new SetAirConditionerTargetTemperatureCommand(
        Temperature.fromCelsius(25),
      ),
    ),
  ).toBe(true);
  expect(
    airConditionerTemperature.supersedes(
      airConditionerTargetRelativeHumidityCommand,
    ),
  ).toBe(false);
  expect(
    airConditionerTargetRelativeHumidityCommand.supersedes(
      new SetAirConditionerTargetRelativeHumidityCommand(0.6),
    ),
  ).toBe(true);
  expect(
    airConditionerTargetRelativeHumidityCommand.supersedes(
      airConditionerTemperature,
    ),
  ).toBe(false);
  expect(
    dehumidifierMode.supersedes(new SetDehumidifierModeCommand('sleep')),
  ).toBe(true);
  expect(
    dehumidifierMode.supersedes(dehumidifierTargetRelativeHumidityCommand),
  ).toBe(false);
  expect(
    dehumidifierTargetRelativeHumidityCommand.supersedes(
      new SetDehumidifierTargetRelativeHumidityCommand(0.6),
    ),
  ).toBe(true);
  expect(fanMode.supersedes(new SetFanModeCommand('natural'))).toBe(true);
  expect(fanMode.supersedes(fanSpeed)).toBe(false);
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
  expect(new SetAirConditionerFanSpeedCommand('auto').toLogString()).toBe(
    'set fanSpeed=auto',
  );
  expect(new SetAirConditionerFanSpeedCommand(0.5).toLogString()).toBe(
    'set fanSpeed=0.5',
  );
  expect(
    new SetAirConditionerTargetTemperatureCommand(
      Temperature.fromCelsius(24),
    ).toLogString(),
  ).toBe('set targetTemperatureCelsius=24');
  expect(
    new SetAirConditionerTargetRelativeHumidityCommand(0.5).toLogString(),
  ).toBe('set targetRelativeHumidity=0.5');
  expect(new SetDehumidifierModeCommand('laundry').toLogString()).toBe(
    'set mode=laundry',
  );
  expect(
    new SetDehumidifierTargetRelativeHumidityCommand(0.5).toLogString(),
  ).toBe('set targetRelativeHumidity=0.5');
  expect(new SetFanModeCommand('natural').toLogString()).toBe(
    'set mode=natural',
  );
  expect(new SetFanSpeedCommand(0.5).toLogString()).toBe('set speed=0.5');
  expect(new SetFanHorizontalSwingCommand(true).toLogString()).toBe(
    'set horizontalSwing=true',
  );
});

test('air conditioner logs temperature and relative humidity state', () => {
  const entry = new DeviceEntry('air conditioner');
  entry.createInstance(AirConditioner);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof AirConditionerEndpoint)) {
    throw new Error('Expected air conditioner endpoint was not created.');
  }

  const logEvents: EndpointStateLogEvent[] = [];
  const removeLogListener = addLogListener(event => {
    if (event.type === 'endpoint-state') {
      logEvents.push(event);
    }
  });

  try {
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
      'auto',
      Temperature.fromCelsius(21.5),
      0.48,
      Temperature.fromCelsius(23.25),
      0.52,
    );

    expect(logEvents.map(event => event.state)).toEqual([
      {ready: false},
      {
        ready: true,
        on: true,
        mode: 'heat',
        fanSpeed: 'auto',
        targetTemperatureCelsius: 21.5,
        targetRelativeHumidity: 0.48,
        temperatureCelsius: 23.25,
        relativeHumidity: 0.52,
      },
    ]);
  } finally {
    removeLogListener();
  }
});

test('dehumidifier logs temperature and relative humidity state', () => {
  const entry = new DeviceEntry('dehumidifier');
  entry.createInstance(Dehumidifier);
  const endpoint = entry.getEndpoint();

  if (!(endpoint instanceof DehumidifierEndpoint)) {
    throw new Error('Expected dehumidifier endpoint was not created.');
  }

  const logEvents: EndpointStateLogEvent[] = [];
  const removeLogListener = addLogListener(event => {
    if (event.type === 'endpoint-state') {
      logEvents.push(event);
    }
  });

  try {
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
      true,
      Temperature.fromCelsius(24.5),
      0.57,
    );

    expect(logEvents.map(event => event.state)).toEqual([
      {ready: false},
      {
        ready: true,
        on: true,
        mode: 'laundry',
        targetRelativeHumidity: 0.45,
        waterTankFull: true,
        temperatureCelsius: 24.5,
        relativeHumidity: 0.57,
      },
    ]);
  } finally {
    removeLogListener();
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

  readonly stateRevision = 0;

  readonly commands: TCommand[] = [];

  constructor(readonly on: boolean) {}

  prepareCommand(command: TCommand): CommandExecution {
    return {
      execute: async () => {
        this.commands.push(command);
      },
    };
  }
}

abstract class BaseTestSensorEndpointConnection<
  TCommand extends Command,
> implements EndpointConnection<TCommand> {
  @observable accessor ready = false;

  @observable accessor stateRevision = 0;

  @observable accessor on = false;

  readonly commands: TCommand[] = [];

  prepareCommand(command: TCommand): CommandExecution {
    return {
      execute: async () => {
        this.commands.push(command);
      },
    };
  }
}

class TestAirConditionerEndpointConnection
  extends BaseTestSensorEndpointConnection<AirConditionerEndpointCommand>
  implements AirConditionerEndpointConnection
{
  @observable accessor mode: AirConditionerEndpointConnection['mode'];

  @observable accessor fanSpeed: AirConditionerEndpointConnection['fanSpeed'];

  @observable.ref
  accessor targetTemperature: AirConditionerEndpointConnection['targetTemperature'];

  @observable accessor targetRelativeHumidity: number | undefined;

  @observable.ref
  accessor temperature: AirConditionerEndpointConnection['temperature'] =
    Temperature.fromKelvin(0);

  @observable accessor relativeHumidity: number | undefined = 0;

  @action
  initialize(
    on: boolean,
    mode: AirConditionerEndpointConnection['mode'],
    fanSpeed: AirConditionerEndpointConnection['fanSpeed'],
    targetTemperature: AirConditionerEndpointConnection['targetTemperature'],
    targetRelativeHumidity: number | undefined,
    temperature: AirConditionerEndpointConnection['temperature'],
    relativeHumidity: number | undefined,
  ): void {
    this.on = on;
    this.mode = mode;
    this.fanSpeed = fanSpeed;
    this.targetTemperature = targetTemperature;
    this.targetRelativeHumidity = targetRelativeHumidity;
    this.temperature = temperature;
    this.relativeHumidity = relativeHumidity;
    this.ready = true;
  }
}

class TestDehumidifierEndpointConnection
  extends BaseTestSensorEndpointConnection<DehumidifierEndpointCommand>
  implements DehumidifierEndpointConnection
{
  @observable accessor mode: DehumidifierEndpointConnection['mode'];

  @observable accessor targetRelativeHumidity: number | undefined;

  @observable accessor waterTankFull: boolean | undefined;

  @observable.ref
  accessor temperature: DehumidifierEndpointConnection['temperature'] =
    Temperature.fromKelvin(0);

  @observable accessor relativeHumidity: number | undefined = 0;

  @action
  initialize(
    on: boolean,
    mode: DehumidifierEndpointConnection['mode'],
    targetRelativeHumidity: number | undefined,
    waterTankFull: boolean | undefined,
    temperature: DehumidifierEndpointConnection['temperature'],
    relativeHumidity: number | undefined,
  ): void {
    this.on = on;
    this.mode = mode;
    this.targetRelativeHumidity = targetRelativeHumidity;
    this.waterTankFull = waterTankFull;
    this.temperature = temperature;
    this.relativeHumidity = relativeHumidity;
    this.ready = true;
  }
}

class TestFanEndpointConnection
  extends BaseTestOnOffEndpointConnection<FanEndpointCommand>
  implements FanEndpointConnection
{
  constructor(
    on: boolean,
    readonly mode: FanEndpointConnection['mode'],
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
