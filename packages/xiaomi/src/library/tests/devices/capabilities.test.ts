import {
  AirConditionerEndpoint,
  type AirConditionerMode,
  type Command,
  type CommandEffect,
  CommandError,
  DehumidifierEndpoint,
  FanEndpoint,
  type LogEvent,
  SetAirConditionerFanSpeedCommand,
  SetAirConditionerModeCommand,
  SetAirConditionerTargetRelativeHumidityCommand,
  SetAirConditionerTargetTemperatureCommand,
  SetDehumidifierModeCommand,
  SetDehumidifierTargetRelativeHumidityCommand,
  SetFanHorizontalSwingCommand,
  SetFanModeCommand,
  SetFanSpeedCommand,
  SetLightBrightnessCommand,
  SetLightColorTemperatureCommand,
  Temperature,
  addLogListener,
  setEndpointLogTarget,
} from '@homelib/core';
import {autorun} from 'mobx';

import {
  type MiotEndpointConnectionConstructor,
  createMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionResources,
} from '../../device.js';
import {MiotAirConditionerEndpointConnection} from '../../devices/air-conditioner.js';
import {MiotDehumidifierEndpointConnection} from '../../devices/dehumidifier.js';
import {MiotFanEndpointConnection} from '../../devices/fan.js';
import {MiotLightEndpointConnection} from '../../devices/light.js';
import {
  type MiotEndpointConnection,
  type MiotEndpointConnectionIdentityMetadata,
  type MiotEndpointConnectionResolvedMetadata,
  MiotEndpointConnectionTransport,
  getMiotEndpointConnectionProperty,
} from '../../endpoint-connection/index.js';
import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  MiotSetPropertyRequest,
  type MiotSpecInstance,
  type MiotSpecProperty,
} from '../../miot/index.js';
import {MiotProvider} from '../../provider.js';

const READ_WRITE_NOTIFY = ['read', 'write', 'notify'] as const;

describe('MIoT air conditioner capabilities', () => {
  test('matches and projects optional mode, fan speed, target temperature, and target humidity', () => {
    const spec = createAirConditionerSpec();
    const persistedMetadata = findPersistedMetadata(spec);
    const metadata = resolveMiotEndpointConnectionMetadata(
      MiotAirConditionerEndpointConnection,
      persistedMetadata,
      spec,
    );
    const controlService = metadata.resources.find(
      resource => resource.service.iid === 2,
    )?.service;

    expect(controlService?.properties).toContainEqual(
      expect.objectContaining({
        iid: 4,
        type: expect.stringContaining('property:target-humidity:'),
      }),
    );
    expect(persistedMetadata).not.toHaveProperty('resources');
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );

    expect(getMetadataProperties(metadata)).toMatchObject({
      on: {iid: 1},
      mode: {iid: 2},
      'fan-level': {iid: 2},
      'target-temperature': {iid: 3},
      'target-humidity': {iid: 4},
    });
    expect(metadata.resources).toMatchObject([
      {service: {iid: 2}},
      {
        service: {iid: 3},
        properties: {'fan-level': {iid: 2}},
      },
      {
        service: {iid: 4},
        properties: {temperature: {iid: 7}, 'relative-humidity': {iid: 9}},
      },
    ]);
    expect(connection.snapshotProperties).toHaveLength(7);
    expect(connection.snapshotProperties).toContainEqual({
      did: metadata.device.did,
      siid: 3,
      piid: 2,
    });
    expect(connection.notificationTargets).toHaveLength(7);
    expect(connection.notificationTargets).toContainEqual({
      type: 'property-change',
      data: {did: metadata.device.did, siid: 3, piid: 2},
    });
    expect(connection.mode).toBeUndefined();
    expect(connection.fanSpeed).toBeUndefined();
    expect(connection.targetTemperature?.kelvin).toBe(0);
    expect(connection.targetRelativeHumidity).toBe(0);
    expect(connection.temperature?.kelvin).toBe(0);
    expect(connection.relativeHumidity).toBe(0);

    updateProperty(connection, metadata, 'mode', 2);
    updateProperty(connection, metadata, 'fan-level', 0);
    updateProperty(connection, metadata, 'target-temperature', 23);
    updateProperty(connection, metadata, 'target-humidity', 55);
    updateProperty(connection, metadata, 'temperature', 24.5);
    updateProperty(connection, metadata, 'relative-humidity', 61);
    expect(connection.mode).toBe('cool');
    expect(connection.fanSpeed).toBe('auto');
    expect(connection.targetTemperature?.celsius).toBeCloseTo(23);
    expect(connection.targetRelativeHumidity).toBe(0.55);
    expect(connection.temperature?.celsius).toBeCloseTo(24.5);
    expect(connection.relativeHumidity).toBe(0.61);

    updateProperty(connection, metadata, 'mode', 5);
    updateProperty(connection, metadata, 'fan-level', 4);
    expect(connection.mode).toBe('heat');
    expect(connection.fanSpeed).toBeCloseTo(3 / 7);
    expect(() => updateProperty(connection, metadata, 'mode', 1)).toThrow(
      TypeError,
    );
    expect(() =>
      updateProperty(connection, metadata, 'target-humidity', 71),
    ).toThrow(TypeError);
  });

  test.each([
    {
      model: 'MT6',
      type: 'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-mt6:6',
      manualLevelCount: 7,
    },
    {
      model: 'RR6R00',
      type: 'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-rr6r00:3',
      manualLevelCount: 8,
    },
  ])(
    'maps Auto and $manualLevelCount manual fan levels for $model',
    async ({type, manualLevelCount}) => {
      const spec = createAirConditionerSpec();
      spec.type = type;
      const fanLevelProperty = requireSpecProperty(spec, 2, 3);
      fanLevelProperty['value-list'] = createValueList([
        0,
        ...Array.from({length: manualLevelCount}, (_, index) => index + 1),
      ]);
      const metadata = findMetadata(MiotAirConditionerEndpointConnection, spec);
      const transport = new TestTransport();
      const connection = new MiotAirConditionerEndpointConnection(
        new MiotProvider('provider'),
        metadata,
        [transport],
      );
      const middleLevelIndex = Math.round((manualLevelCount - 1) / 2);
      const middleLevel = middleLevelIndex + 1;

      updateProperty(connection, metadata, 'fan-level', 0);
      expect(connection.fanSpeed).toBe('auto');
      updateProperty(connection, metadata, 'fan-level', middleLevel);
      expect(connection.fanSpeed).toBeCloseTo(
        middleLevelIndex / (manualLevelCount - 1),
      );
      updateProperty(connection, metadata, 'fan-level', manualLevelCount);
      expect(connection.fanSpeed).toBe(1);

      await executeCommand(
        connection,
        new SetAirConditionerFanSpeedCommand('auto'),
      );
      await executeCommand(connection, new SetAirConditionerFanSpeedCommand(0));
      await executeCommand(
        connection,
        new SetAirConditionerFanSpeedCommand(0.5),
      );
      await executeCommand(connection, new SetAirConditionerFanSpeedCommand(1));

      expect(transport.requests).toEqual([
        createExpectedRequest(metadata, 'fan-level', 0),
        createExpectedRequest(metadata, 'fan-level', 1),
        createExpectedRequest(metadata, 'fan-level', middleLevel),
        createExpectedRequest(metadata, 'fan-level', manualLevelCount),
      ]);
      expect(
        connection
          .prepareCommand(new SetAirConditionerFanSpeedCommand('auto'))
          .toLogString?.(),
      ).toBe('set fan-level=0 (auto)');
    },
  );

  test('maps a single manual fan level to zero', () => {
    const spec = createAirConditionerSpec();
    const fanLevelProperty = requireSpecProperty(spec, 2, 3);
    fanLevelProperty['value-list'] = createValueList([0, 1]);
    const metadata = findMetadata(MiotAirConditionerEndpointConnection, spec);
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );

    updateProperty(connection, metadata, 'fan-level', 1);
    expect(connection.fanSpeed).toBe(0);
  });

  test('maps modes and clamps and quantizes target temperature and humidity writes', async () => {
    const metadata = findMetadata(
      MiotAirConditionerEndpointConnection,
      createAirConditionerSpec(),
    );
    const transport = new TestTransport();
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    await executeCommand(connection, new SetAirConditionerModeCommand('cool'));
    await executeCommand(connection, new SetAirConditionerModeCommand('dry'));
    await executeCommand(connection, new SetAirConditionerModeCommand('fan'));
    await executeCommand(connection, new SetAirConditionerModeCommand('heat'));
    await executeCommand(
      connection,
      new SetAirConditionerTargetTemperatureCommand(
        Temperature.fromCelsius(23.6),
      ),
    );
    await executeCommand(
      connection,
      new SetAirConditionerTargetRelativeHumidityCommand(0.3),
    );
    await executeCommand(
      connection,
      new SetAirConditionerTargetRelativeHumidityCommand(0.584),
    );

    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'mode', 2),
      createExpectedRequest(metadata, 'mode', 3),
      createExpectedRequest(metadata, 'mode', 4),
      createExpectedRequest(metadata, 'mode', 5),
      createExpectedRequest(metadata, 'target-temperature', 23.5),
      createExpectedRequest(metadata, 'target-humidity', 30),
      createExpectedRequest(metadata, 'target-humidity', 58),
    ]);

    const modeExecution = connection.prepareCommand(
      new SetAirConditionerModeCommand('cool'),
    );
    const temperatureExecution = connection.prepareCommand(
      new SetAirConditionerTargetTemperatureCommand(
        Temperature.fromCelsius(23.6),
      ),
    );
    const humidityExecution = connection.prepareCommand(
      new SetAirConditionerTargetRelativeHumidityCommand(0.584),
    );

    expect(modeExecution.toLogString?.()).toBe('set mode=2 (cool)');
    expect(temperatureExecution.toLogString?.()).toBe(
      'set target-temperature=23.5',
    );
    expect(humidityExecution.toLogString?.()).toBe('set target-humidity=58');

    await expect(
      executeCommand(connection, new SetAirConditionerModeCommand('auto')),
    ).rejects.toBeInstanceOf(CommandError);
    expect(transport.requests).toHaveLength(7);

    await executeCommand(
      connection,
      new SetAirConditionerTargetTemperatureCommand(
        Temperature.fromCelsius(15.5),
      ),
    );
    await executeCommand(
      connection,
      new SetAirConditionerTargetTemperatureCommand(
        Temperature.fromCelsius(31.5),
      ),
    );
    await executeCommand(
      connection,
      new SetAirConditionerTargetRelativeHumidityCommand(0.29),
    );
    await executeCommand(
      connection,
      new SetAirConditionerTargetRelativeHumidityCommand(0.71),
    );

    expect(transport.requests.slice(7)).toEqual([
      createExpectedRequest(metadata, 'target-temperature', 16),
      createExpectedRequest(metadata, 'target-temperature', 31),
      createExpectedRequest(metadata, 'target-humidity', 30),
      createExpectedRequest(metadata, 'target-humidity', 70),
    ]);
  });

  test('returns effects using canonical MIoT modes, fan levels, temperature steps, and humidity steps', async () => {
    const metadata = findMetadata(
      MiotAirConditionerEndpointConnection,
      createAirConditionerSpec(),
    );
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );
    const endpoint = new AirConditionerEndpoint();
    endpoint.bindConnection(connection);
    connection.handleStateUpdate({
      did: metadata.device.did,
      online: true,
      properties: createStateProperties(metadata, {
        on: true,
        mode: 2,
        'fan-level': 5,
        'target-temperature': 23.74,
        'target-humidity': 58,
        temperature: 24,
        'relative-humidity': 60,
      }),
    });

    const modeEffect = requireEffect(
      await executeCommand(
        connection,
        new SetAirConditionerModeCommand('cool'),
      ),
    );
    const fanSpeedEffect = requireEffect(
      await executeCommand(
        connection,
        new SetAirConditionerFanSpeedCommand(0.5),
      ),
    );
    const temperatureEffect = requireEffect(
      await executeCommand(
        connection,
        new SetAirConditionerTargetTemperatureCommand(
          Temperature.fromCelsius(23.6),
        ),
      ),
    );
    const humidityEffect = requireEffect(
      await executeCommand(
        connection,
        new SetAirConditionerTargetRelativeHumidityCommand(0.584),
      ),
    );

    expect(modeEffect.matches(endpoint)).toBe(true);
    expect(fanSpeedEffect.matches(endpoint)).toBe(true);
    expect(
      temperatureEffect.equals(
        requireEffect(
          connection.prepareCommand(
            new SetAirConditionerTargetTemperatureCommand(
              Temperature.fromCelsius(23.7),
            ),
          ).effect,
        ),
      ),
    ).toBe(true);
    expect(temperatureEffect.matches(endpoint)).toBe(true);
    expect(
      humidityEffect.equals(
        requireEffect(
          connection.prepareCommand(
            new SetAirConditionerTargetRelativeHumidityCommand(0.581),
          ).effect,
        ),
      ),
    ).toBe(true);
    expect(humidityEffect.matches(endpoint)).toBe(true);
    expect(() =>
      connection.prepareCommand(new SetAirConditionerModeCommand('auto')),
    ).toThrow(CommandError);

    updateProperty(connection, metadata, 'mode', 3);
    updateProperty(connection, metadata, 'fan-level', 4);
    updateProperty(connection, metadata, 'target-temperature', 23.76);
    updateProperty(connection, metadata, 'target-humidity', 59);
    expect(modeEffect.matches(endpoint)).toBe(false);
    expect(fanSpeedEffect.matches(endpoint)).toBe(false);
    expect(temperatureEffect.matches(endpoint)).toBe(false);
    expect(humidityEffect.matches(endpoint)).toBe(false);
  });

  test('logs prepared commands with normalized values', () => {
    const metadata = findMetadata(
      MiotAirConditionerEndpointConnection,
      createAirConditionerSpec(),
    );
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );
    const endpoint = new AirConditionerEndpoint();
    const logEvents: LogEvent[] = [];
    const removeLogListener = addLogListener(event => logEvents.push(event));

    try {
      setEndpointLogTarget(endpoint, {
        scopePath: ['home', 'living room'],
        deviceName: 'air conditioner',
        endpointName: '',
      });
      endpoint.bindConnection(connection);
      endpoint.setTargetTemperature(Temperature.fromCelsius(23.6));
      connection.handleStateUpdate({
        did: metadata.device.did,
        online: true,
        properties: createStateProperties(metadata, {
          on: false,
          mode: 2,
          'fan-level': 0,
          'target-temperature': 20,
          'target-humidity': 30,
          temperature: 20,
          'relative-humidity': 30,
        }),
      });

      expect(
        logEvents
          .filter(event => event.type === 'endpoint-command')
          .map(event => event.commandDescription),
      ).toEqual(['set target-temperature=23.5']);
    } finally {
      removeLogListener();
    }
  });

  test('routes writes by property alias independently of service order', async () => {
    const spec = createAirConditionerSpec();
    const environmentService = spec.services.find(service => service.iid === 4);

    if (environmentService === undefined) {
      throw new Error('Test spec has no environment service.');
    }

    environmentService.iid = 1;
    const metadata = findMetadata(MiotAirConditionerEndpointConnection, spec);
    const transport = new TestTransport();
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    expect(
      metadata.resources.map(resource => resource.service.iid).toSorted(),
    ).toEqual([1, 2, 3]);

    await executeCommand(connection, new SetAirConditionerModeCommand('heat'));

    expect(transport.requests).toEqual([
      new MiotSetPropertyRequest(
        {did: metadata.device.did, siid: 2, piid: 2},
        5,
      ),
    ]);
  });

  test('supports known modes when the device exposes additional values', async () => {
    const spec = createAirConditionerSpec();
    const modeProperty = requireSpecProperty(spec, 2);
    modeProperty['value-list'] = createValueList([0, 2, 3, 4, 5]);
    const metadata = findMetadata(MiotAirConditionerEndpointConnection, spec);
    const transport = new TestTransport();
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    expect(getMetadataPropertyNames(metadata)).toEqual(
      [
        'on',
        'mode',
        'fan-level',
        'target-temperature',
        'target-humidity',
        'temperature',
        'relative-humidity',
      ].toSorted(),
    );
    updateProperty(connection, metadata, 'mode', 0);
    expect(connection.mode).toBeUndefined();
    await executeCommand(connection, new SetAirConditionerModeCommand('cool'));
    expect(transport.requests).toEqual([
      new MiotSetPropertyRequest(
        {did: metadata.device.did, siid: 2, piid: 2},
        2,
      ),
    ]);
  });

  test('treats the MT6 off mode as no active mode', async () => {
    const spec = createAirConditionerSpec();
    spec.type = 'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-mt6:6';
    const modeProperty = requireSpecProperty(spec, 2);
    modeProperty['value-list'] = createValueList([2, 3, 4, 5, 6]);
    const fanLevelProperty = requireSpecProperty(spec, 2, 3);
    fanLevelProperty['value-list'] = createValueList([0, 1, 2, 3, 4, 5, 6, 7]);
    const metadata = findMetadata(MiotAirConditionerEndpointConnection, spec);
    const transport = new TestTransport();
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    updateProperty(connection, metadata, 'mode', 6);
    expect(connection.mode).toBeUndefined();
    expect(connection.fanSpeed).toBeUndefined();

    updateProperty(connection, metadata, 'mode', 2);
    expect(connection.mode).toBe('cool');
    expect(() => updateProperty(connection, metadata, 'mode', 1)).toThrow(
      TypeError,
    );
    await expect(
      executeCommand(
        connection,
        new SetAirConditionerModeCommand('off' as AirConditionerMode),
      ),
    ).rejects.toBeInstanceOf(CommandError);

    await executeCommand(connection, new SetAirConditionerModeCommand('heat'));
    expect(transport.requests).toEqual([
      new MiotSetPropertyRequest(
        {did: metadata.device.did, siid: 2, piid: 2},
        5,
      ),
    ]);
  });

  test('rejects optional commands without matched properties', async () => {
    const metadata = findMetadata(
      MiotAirConditionerEndpointConnection,
      createOnOnlySpec(
        'urn:miot-spec-v2:device:air-conditioner:0000A004:test:1',
        'urn:miot-spec-v2:service:air-conditioner:0000780F:test:1',
      ),
    );
    const transport = new TestTransport();
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    expect(connection.mode).toBeUndefined();
    expect(connection.fanSpeed).toBeUndefined();
    expect(connection.targetTemperature).toBeUndefined();
    expect(connection.targetRelativeHumidity).toBeUndefined();
    await expect(
      executeCommand(connection, new SetAirConditionerModeCommand('cool')),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      executeCommand(connection, new SetAirConditionerFanSpeedCommand(0.5)),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      executeCommand(
        connection,
        new SetAirConditionerTargetTemperatureCommand(
          Temperature.fromCelsius(24),
        ),
      ),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      executeCommand(
        connection,
        new SetAirConditionerTargetRelativeHumidityCommand(0.5),
      ),
    ).rejects.toBeInstanceOf(CommandError);
    expect(connection.targetRelativeHumidity).toBeUndefined();
    expect(transport.requests).toEqual([]);
  });

  test('matches control features without an environment service', () => {
    const spec = createAirConditionerSpec();

    spec.services = spec.services.filter(service => service.iid !== 4);
    const metadata = findMetadata(MiotAirConditionerEndpointConnection, spec);

    expect(metadata.resources.map(resource => resource.service.iid)).toEqual([
      2, 3,
    ]);
    expect(getMetadataPropertyNames(metadata)).toEqual(
      [
        'on',
        'mode',
        'fan-level',
        'target-temperature',
        'target-humidity',
      ].toSorted(),
    );
  });

  test.each([
    {name: 'temperature', iid: 7, remaining: 'relative-humidity'},
    {name: 'relative-humidity', iid: 9, remaining: 'temperature'},
  ])('matches the remaining environment feature without $name', entry => {
    const spec = createAirConditionerSpec();
    removeSpecProperty(spec, 4, entry.iid);
    const metadata = findMetadata(MiotAirConditionerEndpointConnection, spec);

    expect(getMetadataPropertyNames(metadata)).toEqual(
      [
        'on',
        'mode',
        'fan-level',
        'target-temperature',
        'target-humidity',
        entry.remaining,
      ].toSorted(),
    );
  });

  test('fails closed when environment features use separate relevant services', () => {
    const spec = createAirConditionerSpec();
    const environment = requireSpecService(spec, 4);
    const temperatureEnvironment = {
      ...environment,
      iid: 4,
      properties: environment.properties?.filter(
        property => property.iid === 7,
      ),
    };
    const relativeHumidityEnvironment = {
      ...environment,
      iid: 5,
      properties: environment.properties?.filter(
        property => property.iid === 9,
      ),
    };
    spec.services = [
      requireSpecService(spec, 2),
      requireSpecService(spec, 3),
      temperatureEnvironment,
      relativeHumidityEnvironment,
    ];
    expect(
      resolveMiotEndpointConnectionResources(
        MiotAirConditionerEndpointConnection,
        spec,
      ),
    ).toBeUndefined();
  });

  test('fails closed with multiple complete or partial environment services', () => {
    const spec = createAirConditionerSpec();
    const environment = requireSpecService(spec, 4);
    spec.services.push(
      {
        ...environment,
        iid: 5,
        properties: environment.properties?.filter(
          property => property.iid === 7,
        ),
      },
      {
        ...environment,
        iid: 6,
        properties: environment.properties?.filter(
          property => property.iid === 9,
        ),
      },
    );
    expect(
      resolveMiotEndpointConnectionResources(
        MiotAirConditionerEndpointConnection,
        spec,
      ),
    ).toBeUndefined();
  });

  test('matches generic features independently of device type', () => {
    const spec = {
      ...createAirConditionerSpec(),
      type: 'urn:miot-spec-v2:device:other:0000FFFF:test:1',
    };
    const metadata = findMetadata(MiotAirConditionerEndpointConnection, spec);

    expect(
      metadata.resources.map(resource => resource.service.iid).toSorted(),
    ).toEqual([2, 4]);
    expect(getMetadataPropertyNames(metadata)).toEqual(
      [
        'on',
        'mode',
        'target-temperature',
        'target-humidity',
        'temperature',
        'relative-humidity',
      ].toSorted(),
    );
  });

  test('does not infer automatic fan speed from an unverified device type', () => {
    const spec = {
      ...createAirConditionerSpec(),
      type: 'urn:miot-spec-v2:device:air-conditioner:0000A004:maxi-b01x:1',
    };
    const metadata = findMetadata(MiotAirConditionerEndpointConnection, spec);
    const transport = new TestTransport();
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    expect(getMetadataPropertyNames(metadata)).not.toContain('fan-level');
    expect(() =>
      connection.prepareCommand(new SetAirConditionerFanSpeedCommand('auto')),
    ).toThrow(CommandError);
    expect(transport.requests).toEqual([]);
  });

  test('commits control and environment state atomically', () => {
    const metadata = findMetadata(
      MiotAirConditionerEndpointConnection,
      createAirConditionerSpec(),
    );
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );
    const values: Array<
      readonly [
        ready: boolean,
        on: boolean,
        fanSpeed: number | 'auto' | undefined,
        targetTemperature: number,
        targetRelativeHumidity: number | undefined,
        temperature: number,
        relativeHumidity: number | undefined,
      ]
    > = [];
    const dispose = autorun(() => {
      values.push([
        connection.ready,
        connection.on,
        connection.fanSpeed,
        connection.targetTemperature?.kelvin ?? Number.NaN,
        connection.targetRelativeHumidity,
        connection.temperature?.kelvin ?? Number.NaN,
        connection.relativeHumidity,
      ]);
    });

    connection.handleStateUpdate({
      did: metadata.device.did,
      online: true,
      properties: createStateProperties(metadata, {
        on: true,
        mode: 2,
        'fan-level': 4,
        'target-temperature': 23,
        'target-humidity': 55,
        temperature: 24.5,
        'relative-humidity': 61,
      }),
    });

    expect(values).toEqual([
      [false, false, undefined, 0, 0, 0, 0],
      [true, true, 3 / 7, 296.15, 0.55, 297.65, 0.61],
    ]);
    dispose();
  });
});

describe('MIoT dehumidifier capabilities', () => {
  test('matches and projects optional mode, target humidity, and water tank state', () => {
    const metadata = findMetadata(
      MiotDehumidifierEndpointConnection,
      createDehumidifierSpec(),
    );
    const connection = new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );

    expect(getMetadataProperties(metadata)).toMatchObject({
      on: {iid: 1},
      fault: {iid: 2},
      mode: {iid: 3},
      'target-humidity': {iid: 5},
    });
    expect(metadata.resources).toMatchObject([
      {service: {iid: 2}},
      {
        service: {iid: 3},
        properties: {temperature: {iid: 2}, 'relative-humidity': {iid: 1}},
      },
    ]);
    expect(connection.mode).toBeUndefined();
    expect(connection.targetRelativeHumidity).toBe(0);
    expect(connection.waterTankFull).toBeUndefined();
    expect(connection.temperature?.kelvin).toBe(0);
    expect(connection.relativeHumidity).toBe(0);
    expect(connection.snapshotProperties).toContainEqual({
      did: metadata.device.did,
      siid: 2,
      piid: 2,
    });
    expect(connection.cloudPreferredSnapshotProperties).toEqual([
      {did: metadata.device.did, siid: 2, piid: 2},
    ]);
    expect(connection.notificationTargets).toContainEqual({
      type: 'property-change',
      data: {did: metadata.device.did, siid: 2, piid: 2},
    });
    expect(connection.replaySnapshotPropertyNotifications).toEqual([
      {did: metadata.device.did, siid: 2, piid: 2},
    ]);

    updateProperty(connection, metadata, 'fault', 0);
    updateProperty(connection, metadata, 'mode', 1);
    updateProperty(connection, metadata, 'target-humidity', 55);
    // The MIoT step describes write precision. Devices may still report a
    // finer-grained floating-point sensor state.
    updateProperty(connection, metadata, 'temperature', 21.5);
    updateProperty(connection, metadata, 'relative-humidity', 58);
    expect(connection.mode).toBe('sleep');
    expect(connection.targetRelativeHumidity).toBe(0.55);
    expect(connection.waterTankFull).toBe(false);
    expect(connection.temperature?.celsius).toBeCloseTo(21.5);
    expect(connection.relativeHumidity).toBe(0.58);

    updateProperty(connection, metadata, 'mode', 2);
    updateProperty(connection, metadata, 'fault', 1);
    expect(connection.mode).toBe('laundry');
    expect(connection.waterTankFull).toBe(true);
    for (const fault of [2, 3, 4, 5, 6, 7, 8, 9]) {
      updateProperty(connection, metadata, 'fault', fault);
      expect(connection.waterTankFull).toBe(true);
    }
    updateProperty(connection, metadata, 'fault', 0);
    updateProperty(connection, metadata, 'fault', 5);
    expect(connection.waterTankFull).toBe(false);
    expect(() => updateProperty(connection, metadata, 'mode', 3)).toThrow(
      TypeError,
    );
  });

  test('maps modes and clamps and quantizes normalized target humidity writes', async () => {
    const metadata = findMetadata(
      MiotDehumidifierEndpointConnection,
      createDehumidifierSpec(),
    );
    const transport = new TestTransport();
    const connection = new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    await executeCommand(connection, new SetDehumidifierModeCommand('auto'));
    await executeCommand(connection, new SetDehumidifierModeCommand('sleep'));
    await executeCommand(connection, new SetDehumidifierModeCommand('laundry'));
    await executeCommand(
      connection,
      new SetDehumidifierTargetRelativeHumidityCommand(0.3),
    );
    await executeCommand(
      connection,
      new SetDehumidifierTargetRelativeHumidityCommand(0.584),
    );

    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'mode', 0),
      createExpectedRequest(metadata, 'mode', 1),
      createExpectedRequest(metadata, 'mode', 2),
      createExpectedRequest(metadata, 'target-humidity', 30),
      createExpectedRequest(metadata, 'target-humidity', 58),
    ]);
    expect(
      connection
        .prepareCommand(new SetDehumidifierModeCommand('sleep'))
        .toLogString?.(),
    ).toBe('set mode=1 (sleep)');

    await executeCommand(
      connection,
      new SetDehumidifierTargetRelativeHumidityCommand(0.29),
    );
    await executeCommand(
      connection,
      new SetDehumidifierTargetRelativeHumidityCommand(0.71),
    );

    expect(transport.requests.slice(5)).toEqual([
      createExpectedRequest(metadata, 'target-humidity', 30),
      createExpectedRequest(metadata, 'target-humidity', 70),
    ]);
  });

  test('rejects target humidity locally while tank protection is active', async () => {
    const metadata = findMetadata(
      MiotDehumidifierEndpointConnection,
      createDehumidifierSpec(),
    );
    const transport = new TestTransport();
    const connection = new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    updateProperty(connection, metadata, 'fault', 1);

    await expect(
      executeCommand(
        connection,
        new SetDehumidifierTargetRelativeHumidityCommand(0.5),
      ),
    ).rejects.toThrow(
      'Cannot set MIoT dehumidifier target humidity while its water tank is full or unavailable.',
    );
    expect(transport.requests).toEqual([]);

    updateProperty(connection, metadata, 'fault', 0);
    await executeCommand(
      connection,
      new SetDehumidifierTargetRelativeHumidityCommand(0.5),
    );
    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'target-humidity', 50),
    ]);
  });

  test('does not infer the water tank state from another active fault', async () => {
    const metadata = findMetadata(
      MiotDehumidifierEndpointConnection,
      createDehumidifierSpec(),
    );
    const transport = new TestTransport();
    const connection = new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    updateProperty(connection, metadata, 'fault', 5);

    expect(connection.waterTankFull).toBeUndefined();
    await executeCommand(
      connection,
      new SetDehumidifierTargetRelativeHumidityCommand(0.5),
    );
    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'target-humidity', 50),
    ]);
  });

  test('retains the last known water tank state without trusting it after offline', async () => {
    const metadata = findMetadata(
      MiotDehumidifierEndpointConnection,
      createDehumidifierSpec(),
    );
    const transport = new TestTransport();
    const connection = new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    updateProperty(connection, metadata, 'fault', 1);
    expect(connection.waterTankFull).toBe(true);

    connection.handleStateUpdate({
      did: metadata.device.did,
      online: false,
      properties: [],
    });
    expect(connection.waterTankFull).toBe(true);
    expect(connection.getCommandEffectState('fault')).toBeUndefined();

    connection.handleStateUpdate({
      did: metadata.device.did,
      online: true,
      properties: [],
    });
    await executeCommand(
      connection,
      new SetDehumidifierTargetRelativeHumidityCommand(0.5),
    );
    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'target-humidity', 50),
    ]);
  });

  test('retains derived water tank state for every snapshot invalidation path', () => {
    const metadata = findMetadata(
      MiotDehumidifierEndpointConnection,
      createDehumidifierSpec(),
    );
    const connection = new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );
    const {service, property} = getMiotEndpointConnectionProperty(
      metadata,
      'fault',
    );
    const fault = {
      did: metadata.device.did,
      siid: service.iid,
      piid: property.iid,
    } as const;

    updateProperty(connection, metadata, 'fault', 1);
    connection.handleSnapshotInvalidation([fault]);
    expect(connection.waterTankFull).toBe(true);
    expect(connection.getCommandEffectState('fault')).toBeUndefined();

    updateProperty(connection, metadata, 'fault', 1);
    expect(
      connection.handleStateUpdate({
        did: metadata.device.did,
        online: true,
        properties: [],
        invalidatedProperties: [fault],
      }),
    ).toEqual([]);
    expect(connection.waterTankFull).toBe(true);
    expect(connection.getCommandEffectState('fault')).toBeUndefined();

    updateProperty(connection, metadata, 'fault', 1);
    const errors = connection.handleStateUpdate({
      did: metadata.device.did,
      online: true,
      properties: [{...fault, value: 'invalid'}],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
    expect(connection.ready).toBe(true);
    expect(connection.waterTankFull).toBe(true);
    expect(connection.getCommandEffectState('fault')).toBeUndefined();
  });

  test('preserves a satisfied target humidity noop while the water tank is full', () => {
    const metadata = findMetadata(
      MiotDehumidifierEndpointConnection,
      createDehumidifierSpec(),
    );
    const connection = new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );
    const endpoint = new DehumidifierEndpoint();
    endpoint.bindConnection(connection);

    updateProperty(connection, metadata, 'fault', 1);
    updateProperty(connection, metadata, 'target-humidity', 50);

    const effect = requireEffect(
      connection.prepareCommand(
        new SetDehumidifierTargetRelativeHumidityCommand(0.5),
      ).effect,
    );
    expect(effect.matches(endpoint)).toBe(true);
  });

  test('returns independent canonical mode and target humidity effects', async () => {
    const metadata = findMetadata(
      MiotDehumidifierEndpointConnection,
      createDehumidifierSpec(),
    );
    const connection = new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );
    const endpoint = new DehumidifierEndpoint();
    endpoint.bindConnection(connection);
    connection.handleStateUpdate({
      did: metadata.device.did,
      online: true,
      properties: createStateProperties(metadata, {
        on: true,
        fault: 0,
        mode: 1,
        'target-humidity': 58,
        temperature: 22,
        'relative-humidity': 60,
      }),
    });

    const modeEffect = requireEffect(
      await executeCommand(connection, new SetDehumidifierModeCommand('sleep')),
    );
    const humidityEffect = requireEffect(
      await executeCommand(
        connection,
        new SetDehumidifierTargetRelativeHumidityCommand(0.584),
      ),
    );

    expect(modeEffect.matches(endpoint)).toBe(true);
    expect(
      humidityEffect.equals(
        requireEffect(
          connection.prepareCommand(
            new SetDehumidifierTargetRelativeHumidityCommand(0.581),
          ).effect,
        ),
      ),
    ).toBe(true);
    expect(humidityEffect.matches(endpoint)).toBe(true);

    updateProperty(connection, metadata, 'mode', 2);
    updateProperty(connection, metadata, 'target-humidity', 59);
    expect(modeEffect.matches(endpoint)).toBe(false);
    expect(humidityEffect.matches(endpoint)).toBe(false);
  });

  test('rejects optional commands without matched properties', async () => {
    const metadata = findMetadata(
      MiotDehumidifierEndpointConnection,
      createOnOnlySpec(
        'urn:miot-spec-v2:device:dehumidifier:0000A02D:test:1',
        'urn:miot-spec-v2:service:dehumidifier:00007841:test:1',
      ),
    );
    const transport = new TestTransport();
    const connection = new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    expect(connection.mode).toBeUndefined();
    expect(connection.targetRelativeHumidity).toBeUndefined();
    expect(connection.waterTankFull).toBeUndefined();
    await expect(
      executeCommand(connection, new SetDehumidifierModeCommand('auto')),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      executeCommand(
        connection,
        new SetDehumidifierTargetRelativeHumidityCommand(0.5),
      ),
    ).rejects.toBeInstanceOf(CommandError);
    expect(transport.requests).toEqual([]);
  });

  test('supports known modes when the device exposes additional values', () => {
    const spec = createDehumidifierSpec();
    const modeProperty = requireSpecProperty(spec, 3);
    modeProperty['value-list'] = createValueList([0, 1, 2, 3]);
    const metadata = findMetadata(MiotDehumidifierEndpointConnection, spec);
    const connection = new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );

    expect(getMetadataPropertyNames(metadata)).toEqual(
      [
        'on',
        'fault',
        'mode',
        'target-humidity',
        'temperature',
        'relative-humidity',
      ].toSorted(),
    );
    updateProperty(connection, metadata, 'mode', 3);
    expect(connection.mode).toBeUndefined();
  });

  test('matches control features without an environment service', () => {
    const spec = createDehumidifierSpec();
    spec.type = 'urn:miot-spec-v2:device:other:0000FFFF:test:1';

    spec.services = spec.services.filter(service => service.iid !== 3);
    const metadata = findMetadata(MiotDehumidifierEndpointConnection, spec);

    expect(metadata.resources.map(resource => resource.service.iid)).toEqual([
      2,
    ]);
    expect(getMetadataPropertyNames(metadata)).toEqual(
      ['on', 'mode', 'target-humidity'].toSorted(),
    );
  });

  test.each([
    {name: 'temperature', iid: 2, remaining: 'relative-humidity'},
    {name: 'relative-humidity', iid: 1, remaining: 'temperature'},
  ])('matches the remaining environment feature without $name', entry => {
    const spec = createDehumidifierSpec();
    removeSpecProperty(spec, 3, entry.iid);
    const metadata = findMetadata(MiotDehumidifierEndpointConnection, spec);

    expect(getMetadataPropertyNames(metadata)).toEqual(
      ['on', 'fault', 'mode', 'target-humidity', entry.remaining].toSorted(),
    );
  });

  test('fails closed when environment features use separate relevant services', () => {
    const spec = createDehumidifierSpec();
    const environment = requireSpecService(spec, 3);
    const temperatureEnvironment = {
      ...environment,
      iid: 3,
      properties: environment.properties?.filter(
        property => property.iid === 2,
      ),
    };
    const relativeHumidityEnvironment = {
      ...environment,
      iid: 4,
      properties: environment.properties?.filter(
        property => property.iid === 1,
      ),
    };
    spec.services = [
      requireSpecService(spec, 2),
      temperatureEnvironment,
      relativeHumidityEnvironment,
    ];
    expect(
      resolveMiotEndpointConnectionResources(
        MiotDehumidifierEndpointConnection,
        spec,
      ),
    ).toBeUndefined();
  });

  test('fails closed with multiple complete or partial environment services', () => {
    const spec = createDehumidifierSpec();
    const environment = requireSpecService(spec, 3);
    spec.services.push(
      {
        ...environment,
        iid: 4,
        properties: environment.properties?.filter(
          property => property.iid === 2,
        ),
      },
      {
        ...environment,
        iid: 5,
        properties: environment.properties?.filter(
          property => property.iid === 1,
        ),
      },
    );
    expect(
      resolveMiotEndpointConnectionResources(
        MiotDehumidifierEndpointConnection,
        spec,
      ),
    ).toBeUndefined();
  });

  test.each([
    {
      type: 'urn:miot-spec-v2:device:other:0000FFFF:test:1',
      waterTankState: false,
    },
    {
      type: 'urn:miot-spec-v2:device:dehumidifier:0000A02D:xiaomi-13l:2',
      waterTankState: true,
    },
  ])(
    'keeps generic features while matching model-specific water tank state ($type)',
    entry => {
      const {type} = entry;
      const spec = {...createDehumidifierSpec(), type};
      const metadata = findMetadata(MiotDehumidifierEndpointConnection, spec);

      expect(
        metadata.resources.map(resource => resource.service.iid).toSorted(),
      ).toEqual([2, 3]);
      expect(getMetadataPropertyNames(metadata)).toEqual(
        [
          'on',
          ...(entry.waterTankState ? ['fault'] : []),
          'mode',
          'target-humidity',
          'temperature',
          'relative-humidity',
        ].toSorted(),
      );
    },
  );
});

describe('MIoT light capabilities', () => {
  test('keeps optional state independent from command support', async () => {
    const metadata = findMetadata(
      MiotLightEndpointConnection,
      createLightSpec(),
    );
    const transport = new TestTransport();
    const connection = new MiotLightEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    expect(connection.snapshotProperties).toEqual([
      {did: metadata.device.did, siid: 2, piid: 1},
      {did: metadata.device.did, siid: 2, piid: 2},
      {did: metadata.device.did, siid: 2, piid: 3},
    ]);
    expect(connection.notificationTargets).toEqual([
      {
        type: 'property-change',
        data: {did: metadata.device.did, siid: 2, piid: 1},
      },
      {
        type: 'property-change',
        data: {did: metadata.device.did, siid: 2, piid: 2},
      },
      {
        type: 'property-change',
        data: {did: metadata.device.did, siid: 2, piid: 3},
      },
    ]);

    connection.handleStateUpdate({
      did: metadata.device.did,
      online: true,
      properties: createStateProperties(metadata, {on: false}),
    });

    expect(connection.ready).toBe(true);
    expect(connection.on).toBe(false);
    expect(connection.brightness).toBeUndefined();
    expect(connection.colorTemperature).toBeUndefined();

    await executeCommand(connection, new SetLightBrightnessCommand(0.5));
    await executeCommand(connection, new SetLightColorTemperatureCommand(2700));

    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'brightness', 50),
      createExpectedRequest(metadata, 'color-temperature', 2700),
    ]);
  });

  test('projects successful optional observations', () => {
    const metadata = findMetadata(
      MiotLightEndpointConnection,
      createLightSpec(),
    );
    const connection = new MiotLightEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );

    connection.handleStateUpdate({
      did: metadata.device.did,
      online: true,
      properties: createStateProperties(metadata, {
        on: true,
        brightness: 1,
        'color-temperature': 2700,
      }),
    });

    expect(connection.ready).toBe(true);
    expect(connection.on).toBe(true);
    expect(connection.brightness).toBe(0.01);
    expect(connection.colorTemperature).toBe(2700);
  });

  test('rejects optional commands only when their properties are unresolved', async () => {
    const metadata = findMetadata(
      MiotLightEndpointConnection,
      createOnOnlySpec(
        'urn:miot-spec-v2:device:light:0000A001:test:1',
        'urn:miot-spec-v2:service:light:00007802:test:1',
      ),
    );
    const transport = new TestTransport();
    const connection = new MiotLightEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    expect(connection.snapshotProperties).toEqual([
      {did: metadata.device.did, siid: 2, piid: 1},
    ]);
    expect(connection.brightness).toBeUndefined();
    expect(connection.colorTemperature).toBeUndefined();
    await expect(
      executeCommand(connection, new SetLightBrightnessCommand(0.5)),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      executeCommand(connection, new SetLightColorTemperatureCommand(2700)),
    ).rejects.toBeInstanceOf(CommandError);
    expect(transport.requests).toEqual([]);
  });
});

describe('MIoT fan capabilities', () => {
  test('uses the device URN codec branch for state and command values', async () => {
    const spec = {
      ...createFanSpec(),
      type: 'urn:miot-spec-v2:device:fan:0000A005:zhimi-fa1:1',
    };
    const metadata = findMetadata(MiotFanEndpointConnection, spec);
    const transport = new TestTransport();
    const connection = new MiotFanEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    updateProperty(connection, metadata, 'mode', 0);
    expect(connection.mode).toBe('natural');

    await executeCommand(connection, new SetFanModeCommand('normal'));
    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'mode', 1),
    ]);
    expect(
      connection
        .prepareCommand(new SetFanModeCommand('normal'))
        .toLogString?.(),
    ).toBe('set mode=1 (normal)');
  });

  test('returns undefined for an unmapped but physically valid mode', () => {
    const spec = createFanSpec();
    requireSpecProperty(spec, 2)['value-list'] = createValueList([0, 1, 2]);
    const metadata = findMetadata(MiotFanEndpointConnection, spec);
    const connection = new MiotFanEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );

    updateProperty(connection, metadata, 'mode', 2);
    expect(connection.mode).toBeUndefined();
  });

  test('matches and projects mode, normalized speed, and swing', () => {
    const metadata = findMetadata(MiotFanEndpointConnection, createFanSpec());
    const connection = new MiotFanEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );

    expect(getMetadataProperties(metadata)).toMatchObject({
      on: {iid: 1},
      mode: {iid: 2},
      'fan-level': {iid: 3},
      'horizontal-swing': {iid: 4},
    });
    expect(connection.mode).toBeUndefined();
    expect(connection.speed).toBe(0);
    expect(connection.horizontalSwing).toBe(false);

    updateProperty(connection, metadata, 'mode', 1);
    updateProperty(connection, metadata, 'fan-level', 3);
    updateProperty(connection, metadata, 'horizontal-swing', true);
    expect(connection.mode).toBe('natural');
    expect(connection.speed).toBe(0.75);
    expect(connection.horizontalSwing).toBe(true);

    expect(() => updateProperty(connection, metadata, 'fan-level', 0)).toThrow(
      TypeError,
    );
  });

  test('maps mode, quantizes speed, and writes horizontal swing', async () => {
    const metadata = findMetadata(MiotFanEndpointConnection, createFanSpec());
    const transport = new TestTransport();
    const connection = new MiotFanEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    await executeCommand(connection, new SetFanModeCommand('normal'));
    await executeCommand(connection, new SetFanModeCommand('natural'));
    await executeCommand(connection, new SetFanSpeedCommand(0.01));
    await executeCommand(connection, new SetFanSpeedCommand(0.38));
    await executeCommand(connection, new SetFanSpeedCommand(1));
    await executeCommand(connection, new SetFanHorizontalSwingCommand(true));

    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'mode', 0),
      createExpectedRequest(metadata, 'mode', 1),
      createExpectedRequest(metadata, 'fan-level', 1),
      createExpectedRequest(metadata, 'fan-level', 2),
      createExpectedRequest(metadata, 'fan-level', 4),
      createExpectedRequest(metadata, 'horizontal-swing', true),
    ]);
  });

  test('returns independent canonical mode, speed, and swing effects', async () => {
    const metadata = findMetadata(MiotFanEndpointConnection, createFanSpec());
    const connection = new MiotFanEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );
    const endpoint = new FanEndpoint();
    endpoint.bindConnection(connection);
    connection.handleStateUpdate({
      did: metadata.device.did,
      online: true,
      properties: createStateProperties(metadata, {
        on: true,
        mode: 0,
        'fan-level': 2,
        'horizontal-swing': true,
      }),
    });

    const modeEffect = requireEffect(
      await executeCommand(connection, new SetFanModeCommand('normal')),
    );
    const speedEffect = requireEffect(
      await executeCommand(connection, new SetFanSpeedCommand(0.38)),
    );
    const swingEffect = requireEffect(
      await executeCommand(connection, new SetFanHorizontalSwingCommand(true)),
    );

    expect(modeEffect.matches(endpoint)).toBe(true);
    expect(
      speedEffect.equals(
        requireEffect(
          connection.prepareCommand(new SetFanSpeedCommand(0.49)).effect,
        ),
      ),
    ).toBe(true);
    expect(speedEffect.matches(endpoint)).toBe(true);
    expect(swingEffect.matches(endpoint)).toBe(true);

    updateProperty(connection, metadata, 'fan-level', 3);
    expect(modeEffect.matches(endpoint)).toBe(true);
    expect(speedEffect.matches(endpoint)).toBe(false);
    expect(swingEffect.matches(endpoint)).toBe(true);
  });

  test('rejects optional commands without matched properties', async () => {
    const metadata = findMetadata(
      MiotFanEndpointConnection,
      createOnOnlySpec(
        'urn:miot-spec-v2:device:fan:0000A005:test:1',
        'urn:miot-spec-v2:service:fan:00007808:test:1',
      ),
    );
    const transport = new TestTransport();
    const connection = new MiotFanEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    expect(connection.mode).toBeUndefined();
    expect(connection.speed).toBeUndefined();
    expect(connection.horizontalSwing).toBeUndefined();
    await expect(
      executeCommand(connection, new SetFanModeCommand('normal')),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      executeCommand(connection, new SetFanSpeedCommand(0.5)),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      executeCommand(connection, new SetFanHorizontalSwingCommand(true)),
    ).rejects.toBeInstanceOf(CommandError);
    expect(transport.requests).toEqual([]);
  });

  test('derives fan levels from the device value list', () => {
    const spec = createFanSpec();
    const speedProperty = requireSpecProperty(spec, 3);
    speedProperty['value-list'] = createValueList([1, 2, 3]);
    const metadata = findMetadata(MiotFanEndpointConnection, spec);
    const connection = new MiotFanEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );

    expect(getMetadataPropertyNames(metadata)).toEqual(
      ['on', 'mode', 'fan-level', 'horizontal-swing'].toSorted(),
    );
    updateProperty(connection, metadata, 'fan-level', 2);
    expect(connection.speed).toBeCloseTo(2 / 3);
  });

  test.each([
    'urn:miot-spec-v2:device:other:0000FFFF:test:1',
    'urn:miot-spec-v2:device:fan:0000A005:dmaker-p5c:2',
  ])('matches complete features independently of device type (%s)', type => {
    const spec = {...createFanSpec(), type};
    const metadata = findMetadata(MiotFanEndpointConnection, spec);

    expect(metadata.resources.map(resource => resource.service.iid)).toEqual([
      2,
    ]);
    expect(getMetadataPropertyNames(metadata)).toEqual(
      ['on', 'mode', 'fan-level', 'horizontal-swing'].toSorted(),
    );
  });
});

function createAirConditionerSpec(): MiotSpecInstance {
  const spec = createOnOnlySpec(
    'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-rr6r00:3',
    'urn:miot-spec-v2:service:air-conditioner:0000780F:test:1',
  );
  const [service] = spec.services;

  if (service === undefined) {
    throw new Error('Test spec has no service.');
  }

  service.properties?.push(
    createValueListProperty(
      2,
      'urn:miot-spec-v2:property:mode:00000008:test:1',
      [2, 3, 4, 5],
    ),
    createRangeProperty(
      3,
      'urn:miot-spec-v2:property:target-temperature:00000021:test:1',
      'float',
      'celsius',
      [16, 31, 0.5],
    ),
    createRangeProperty(
      4,
      'urn:miot-spec-v2:property:target-humidity:00000022:test:1',
      'uint8',
      'percentage',
      [30, 70, 1],
    ),
  );
  spec.services.push(
    createAirConditionerFanControlService(8),
    createEnvironmentService(4, 7, [-50, 150, 0.1], 9),
  );
  return spec;
}

function createAirConditionerFanControlService(
  manualLevelCount: number,
): MiotSpecInstance['services'][number] {
  return {
    iid: 3,
    type: 'urn:miot-spec-v2:service:fan-control:00007809:test:1',
    description: 'Fan Control',
    properties: [
      createValueListProperty(
        2,
        'urn:miot-spec-v2:property:fan-level:00000016:test:1',
        [0, ...Array.from({length: manualLevelCount}, (_, index) => index + 1)],
      ),
    ],
  };
}

function createDehumidifierSpec(): MiotSpecInstance {
  const spec = createOnOnlySpec(
    'urn:miot-spec-v2:device:dehumidifier:0000A02D:xiaomi-13l:1',
    'urn:miot-spec-v2:service:dehumidifier:00007841:test:1',
  );
  const [service] = spec.services;

  if (service === undefined) {
    throw new Error('Test spec has no service.');
  }

  service.properties?.push(
    {
      ...createValueListProperty(
        2,
        'urn:miot-spec-v2:property:fault:00000009:test:1',
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      ),
      description: 'Device Fault',
      access: ['read', 'notify'],
      'value-list': [
        {value: 0, description: 'No Faults'},
        {value: 1, description: 'Water Full'},
        {value: 2, description: 'Sensor Fault1'},
        {value: 3, description: 'Sensor Fault2'},
        {value: 4, description: 'Communication Fault1'},
        {value: 5, description: 'Filter Clean'},
        {value: 6, description: 'Defrost'},
        {value: 7, description: 'Fan Motor'},
        {value: 8, description: 'Overload'},
        {value: 9, description: 'Lack Of Refrigerant'},
      ],
    },
    createValueListProperty(
      3,
      'urn:miot-spec-v2:property:mode:00000008:test:1',
      [0, 1, 2],
    ),
    createRangeProperty(
      5,
      'urn:miot-spec-v2:property:target-humidity:00000022:test:1',
      'uint8',
      'percentage',
      [30, 70, 1],
    ),
  );
  spec.services.push(createEnvironmentService(3, 2, [-30, 100, 1], 1));
  return spec;
}

function createLightSpec(): MiotSpecInstance {
  const spec = createOnOnlySpec(
    'urn:miot-spec-v2:device:light:0000A001:test:1',
    'urn:miot-spec-v2:service:light:00007802:test:1',
  );
  const [service] = spec.services;

  if (service === undefined) {
    throw new Error('Test spec has no service.');
  }

  service.properties?.push(
    createRangeProperty(
      2,
      'urn:miot-spec-v2:property:brightness:0000000D:test:1',
      'uint8',
      'percentage',
      [1, 100, 1],
    ),
    createRangeProperty(
      3,
      'urn:miot-spec-v2:property:color-temperature:0000000F:test:1',
      'uint32',
      'kelvin',
      [1700, 7000, 1],
    ),
  );
  return spec;
}

function createEnvironmentService(
  serviceIid: number,
  temperatureIid: number,
  temperatureRange: [number, number, number],
  relativeHumidityIid: number,
): MiotSpecInstance['services'][number] {
  return {
    iid: serviceIid,
    type: 'urn:miot-spec-v2:service:environment:0000780A:test:1',
    description: 'Environment',
    properties: [
      {
        ...createRangeProperty(
          temperatureIid,
          'urn:miot-spec-v2:property:temperature:00000020:test:1',
          'float',
          'celsius',
          temperatureRange,
        ),
        access: ['read', 'notify'],
      },
      {
        ...createRangeProperty(
          relativeHumidityIid,
          'urn:miot-spec-v2:property:relative-humidity:0000000C:test:1',
          'uint8',
          'percentage',
          [0, 100, 1],
        ),
        access: ['read', 'notify'],
      },
    ],
  };
}

function createFanSpec(): MiotSpecInstance {
  const spec = createOnOnlySpec(
    'urn:miot-spec-v2:device:fan:0000A005:dmaker-p5c:1',
    'urn:miot-spec-v2:service:fan:00007808:test:1',
  );
  const [service] = spec.services;

  if (service === undefined) {
    throw new Error('Test spec has no service.');
  }

  service.properties?.push(
    createValueListProperty(
      2,
      'urn:miot-spec-v2:property:mode:00000008:test:1',
      [0, 1],
    ),
    createValueListProperty(
      3,
      'urn:miot-spec-v2:property:fan-level:00000016:test:1',
      [1, 2, 3, 4],
    ),
    {
      iid: 4,
      type: 'urn:miot-spec-v2:property:horizontal-swing:00000017:test:1',
      description: 'Horizontal Swing',
      format: 'bool',
      access: [...READ_WRITE_NOTIFY],
    },
  );
  return spec;
}

function createOnOnlySpec(
  deviceType: string,
  serviceType: string,
): MiotSpecInstance {
  return {
    type: deviceType,
    description: 'test device',
    services: [
      {
        iid: 2,
        type: serviceType,
        description: 'test service',
        properties: [
          {
            iid: 1,
            type: 'urn:miot-spec-v2:property:on:00000006:test:1',
            description: 'Switch Status',
            format: 'bool',
            access: [...READ_WRITE_NOTIFY],
          },
        ],
      },
    ],
  };
}

function createValueListProperty(
  iid: number,
  type: string,
  values: readonly number[],
): MiotSpecProperty {
  return {
    iid,
    type,
    description: 'Mode',
    format: 'uint8',
    access: [...READ_WRITE_NOTIFY],
    'value-list': createValueList(values),
  };
}

function createValueList(
  values: readonly number[],
): Array<{value: number; description: string}> {
  return values.map(value => ({value, description: `Value ${value}`}));
}

function createRangeProperty(
  iid: number,
  type: string,
  format: string,
  unit: string,
  valueRange: [number, number, number],
): MiotSpecProperty {
  return {
    iid,
    type,
    description: 'Target',
    format,
    access: [...READ_WRITE_NOTIFY],
    unit,
    'value-range': valueRange,
  };
}

function findMetadata(
  Connection: MiotEndpointConnectionConstructor,
  spec: MiotSpecInstance,
): MiotEndpointConnectionResolvedMetadata {
  return resolveMiotEndpointConnectionMetadata(
    Connection,
    findPersistedMetadata(spec),
    spec,
  );
}

function findPersistedMetadata(
  spec: MiotSpecInstance,
): MiotEndpointConnectionIdentityMetadata {
  return createMiotEndpointConnectionMetadata(
    {did: 'device-1', model: 'test.device'},
    spec,
  );
}

function requireSpecProperty(
  spec: MiotSpecInstance,
  iid: number,
  serviceIid = 2,
): MiotSpecProperty {
  const property = spec.services
    .find(service => service.iid === serviceIid)
    ?.properties?.find(item => item.iid === iid);

  if (property === undefined) {
    throw new Error(`Test spec has no property ${iid}.`);
  }

  return property;
}

function requireSpecService(
  spec: MiotSpecInstance,
  iid: number,
): MiotSpecInstance['services'][number] {
  const service = spec.services.find(item => item.iid === iid);

  if (service === undefined) {
    throw new Error(`Test spec has no service ${iid}.`);
  }

  return service;
}

function removeSpecProperty(
  spec: MiotSpecInstance,
  serviceIid: number,
  propertyIid: number,
): void {
  const service = spec.services.find(item => item.iid === serviceIid);

  if (service === undefined) {
    throw new Error(`Test spec has no service ${serviceIid}.`);
  }

  service.properties = service.properties?.filter(
    property => property.iid !== propertyIid,
  );
}

function updateProperty(
  connection: MiotEndpointConnection<never>,
  metadata: MiotEndpointConnectionResolvedMetadata,
  name: string,
  value: unknown,
): void {
  const {service, property} = getMiotEndpointConnectionProperty(metadata, name);

  connection.handlePropertyUpdate({
    did: metadata.device.did,
    siid: service.iid,
    piid: property.iid,
    value,
  });
}

function createExpectedRequest(
  metadata: MiotEndpointConnectionResolvedMetadata,
  name: string,
  value: unknown,
): MiotSetPropertyRequest {
  const {service, property} = getMiotEndpointConnectionProperty(metadata, name);

  return new MiotSetPropertyRequest(
    {
      did: metadata.device.did,
      siid: service.iid,
      piid: property.iid,
    },
    value,
  );
}

function requireEffect(effect: CommandEffect | undefined): CommandEffect {
  if (effect === undefined) {
    throw new Error('MIoT stateful command returned no effect.');
  }

  return effect;
}

async function executeCommand<TCommand extends Command>(
  connection: MiotEndpointConnection<TCommand>,
  command: TCommand,
): Promise<CommandEffect | undefined> {
  const execution = connection.prepareCommand(command);
  await execution.execute();
  return execution.effect;
}

function getMetadataProperties(
  metadata: MiotEndpointConnectionResolvedMetadata,
): Readonly<Record<string, MiotSpecProperty>> {
  return Object.assign(
    {},
    ...metadata.resources.map(resource => resource.properties),
  ) as Readonly<Record<string, MiotSpecProperty>>;
}

function getMetadataPropertyNames(
  metadata: MiotEndpointConnectionResolvedMetadata,
): string[] {
  return Object.keys(getMetadataProperties(metadata)).toSorted();
}

function createStateProperties(
  metadata: MiotEndpointConnectionResolvedMetadata,
  values: Readonly<Record<string, unknown>>,
): Array<{
  readonly did: string;
  readonly siid: number;
  readonly piid: number;
  readonly value: unknown;
}> {
  return Object.entries(values).map(([name, value]) => {
    const {service, property} = getMiotEndpointConnectionProperty(
      metadata,
      name,
    );

    return {
      did: metadata.device.did,
      siid: service.iid,
      piid: property.iid,
      value,
    };
  });
}

class TestTransport extends MiotEndpointConnectionTransport {
  readonly requests: MiotExecutionRequest[] = [];

  override async executeRequest(
    request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult> {
    this.requests.push(request);
    return {code: 0};
  }
}
