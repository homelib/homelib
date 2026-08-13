import {
  AirConditionerEndpoint,
  type Command,
  type CommandEffect,
  CommandError,
  DehumidifierEndpoint,
  FanEndpoint,
  SetAirConditionerModeCommand,
  SetAirConditionerTargetHumidityCommand,
  SetAirConditionerTargetTemperatureCommand,
  SetDehumidifierModeCommand,
  SetDehumidifierTargetHumidityCommand,
  SetFanHorizontalSwingCommand,
  SetFanSpeedCommand,
  SetFanWindModeCommand,
  Temperature,
} from '@homelib/core';
import {autorun} from 'mobx';

import type {MiotEndpointAdapter} from '../endpoint-adapter.js';
import {
  type MiotEndpointConnection,
  type MiotEndpointConnectionMetadata,
  type MiotEndpointConnectionResolvedMetadata,
  MiotEndpointConnectionTransport,
  getMiotEndpointConnectionProperty,
  normalizeMiotEndpointConnectionMetadata,
} from '../endpoint-connection.js';
import {
  type MiotExecutionRequest,
  type MiotExecutionResult,
  MiotSetPropertyRequest,
  type MiotSpecInstance,
  type MiotSpecProperty,
} from '../miot/index.js';
import {MiotProvider} from '../provider.js';

import {
  MiotAirConditionerEndpointConnection,
  miotAirConditionerEndpointAdapter,
} from './air-conditioner.js';
import {
  MiotDehumidifierEndpointConnection,
  miotDehumidifierEndpointAdapter,
} from './dehumidifier.js';
import {MiotFanEndpointConnection, miotFanEndpointAdapter} from './fan.js';

const READ_WRITE_NOTIFY = ['read', 'write', 'notify'] as const;

describe('MIoT air conditioner capabilities', () => {
  test('matches and projects optional mode, target temperature, and target humidity', () => {
    const persistedMetadata = findPersistedMetadata(
      miotAirConditionerEndpointAdapter,
      createAirConditionerSpec(),
    );
    const controlService = persistedMetadata.resources.find(
      resource => resource.service.iid === 2,
    )?.service;

    expect(controlService?.properties).toContainEqual(
      expect.objectContaining({
        iid: 4,
        type: expect.stringContaining('property:target-humidity:'),
      }),
    );
    expect(
      persistedMetadata.resources.every(
        resource => !Object.hasOwn(resource, 'properties'),
      ),
    ).toBe(true);

    const normalizedLegacyMetadata = normalizeMiotEndpointConnectionMetadata({
      ...persistedMetadata,
      resources: persistedMetadata.resources.map(resource => ({
        ...resource,
        properties: {on: {iid: 1}},
      })),
    });
    const metadata = miotAirConditionerEndpointAdapter.resolveMetadata(
      normalizedLegacyMetadata,
    );
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );

    expect(getMetadataProperties(metadata)).toMatchObject({
      on: {iid: 1},
      mode: {iid: 2},
      targetTemperature: {iid: 3},
      targetRelativeHumidity: {iid: 4},
    });
    expect(metadata.resources).toMatchObject([
      {service: {iid: 2}},
      {
        service: {iid: 4},
        properties: {temperature: {iid: 7}, relativeHumidity: {iid: 9}},
      },
    ]);
    expect(connection.stateProperties).toHaveLength(6);
    expect(connection.mode).toBe('cool');
    expect(connection.targetTemperature?.kelvin).toBe(0);
    expect(connection.targetRelativeHumidity).toBe(0);
    expect(connection.temperature?.kelvin).toBe(0);
    expect(connection.relativeHumidity).toBe(0);

    updateProperty(connection, metadata, 'mode', 2);
    updateProperty(connection, metadata, 'targetTemperature', 23);
    updateProperty(connection, metadata, 'targetRelativeHumidity', 55);
    updateProperty(connection, metadata, 'temperature', 24.5);
    updateProperty(connection, metadata, 'relativeHumidity', 61);
    expect(connection.mode).toBe('cool');
    expect(connection.targetTemperature?.celsius).toBeCloseTo(23);
    expect(connection.targetRelativeHumidity).toBe(0.55);
    expect(connection.temperature?.celsius).toBeCloseTo(24.5);
    expect(connection.relativeHumidity).toBe(0.61);

    updateProperty(connection, metadata, 'mode', 5);
    expect(connection.mode).toBe('heat');
    expect(() => updateProperty(connection, metadata, 'mode', 1)).toThrow(
      TypeError,
    );
    expect(() =>
      updateProperty(connection, metadata, 'targetRelativeHumidity', 71),
    ).toThrow(TypeError);
  });

  test('maps modes and clamps and quantizes target temperature and humidity writes', async () => {
    const metadata = findMetadata(
      miotAirConditionerEndpointAdapter,
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
      new SetAirConditionerTargetHumidityCommand(0.3),
    );
    await executeCommand(
      connection,
      new SetAirConditionerTargetHumidityCommand(0.584),
    );

    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'mode', 2),
      createExpectedRequest(metadata, 'mode', 3),
      createExpectedRequest(metadata, 'mode', 4),
      createExpectedRequest(metadata, 'mode', 5),
      createExpectedRequest(metadata, 'targetTemperature', 23.5),
      createExpectedRequest(metadata, 'targetRelativeHumidity', 30),
      createExpectedRequest(metadata, 'targetRelativeHumidity', 58),
    ]);

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
      new SetAirConditionerTargetHumidityCommand(0.29),
    );
    await executeCommand(
      connection,
      new SetAirConditionerTargetHumidityCommand(0.71),
    );

    expect(transport.requests.slice(7)).toEqual([
      createExpectedRequest(metadata, 'targetTemperature', 16),
      createExpectedRequest(metadata, 'targetTemperature', 31),
      createExpectedRequest(metadata, 'targetRelativeHumidity', 30),
      createExpectedRequest(metadata, 'targetRelativeHumidity', 70),
    ]);
  });

  test('returns effects using canonical MIoT modes, temperature steps, and humidity steps', async () => {
    const metadata = findMetadata(
      miotAirConditionerEndpointAdapter,
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
        targetTemperature: 23.74,
        targetRelativeHumidity: 58,
        temperature: 24,
        relativeHumidity: 60,
      }),
    });

    const modeEffect = requireEffect(
      await executeCommand(
        connection,
        new SetAirConditionerModeCommand('cool'),
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
        new SetAirConditionerTargetHumidityCommand(0.584),
      ),
    );

    expect(modeEffect.matches(endpoint)).toBe(true);
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
            new SetAirConditionerTargetHumidityCommand(0.581),
          ).effect,
        ),
      ),
    ).toBe(true);
    expect(humidityEffect.matches(endpoint)).toBe(true);
    expect(() =>
      connection.prepareCommand(new SetAirConditionerModeCommand('auto')),
    ).toThrow(CommandError);

    updateProperty(connection, metadata, 'mode', 3);
    updateProperty(connection, metadata, 'targetTemperature', 23.76);
    updateProperty(connection, metadata, 'targetRelativeHumidity', 59);
    expect(modeEffect.matches(endpoint)).toBe(false);
    expect(temperatureEffect.matches(endpoint)).toBe(false);
    expect(humidityEffect.matches(endpoint)).toBe(false);
  });

  test('routes writes by property alias when the control service is not first', async () => {
    const spec = createAirConditionerSpec();
    const environmentService = spec.services.find(service => service.iid === 4);

    if (environmentService === undefined) {
      throw new Error('Test spec has no environment service.');
    }

    environmentService.iid = 1;
    const metadata = findMetadata(miotAirConditionerEndpointAdapter, spec);
    const transport = new TestTransport();
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    expect(metadata.resources.map(resource => resource.service.iid)).toEqual([
      1, 2,
    ]);

    await executeCommand(connection, new SetAirConditionerModeCommand('heat'));

    expect(transport.requests).toEqual([
      new MiotSetPropertyRequest(
        {did: metadata.device.did, siid: 2, piid: 2},
        5,
      ),
    ]);
  });

  test('omits non-exact mode lists and rejects missing optional commands', async () => {
    const spec = createAirConditionerSpec();
    const modeProperty = requireSpecProperty(spec, 2);
    modeProperty['value-list'] = createValueList([0, 2, 3, 4, 5]);
    const metadata = findMetadata(miotAirConditionerEndpointAdapter, spec);
    const transport = new TestTransport();
    const connection = new MiotAirConditionerEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    expect(getMetadataPropertyNames(metadata)).toEqual(
      [
        'on',
        'targetTemperature',
        'targetRelativeHumidity',
        'temperature',
        'relativeHumidity',
      ].toSorted(),
    );
    await expect(
      executeCommand(connection, new SetAirConditionerModeCommand('cool')),
    ).rejects.toBeInstanceOf(CommandError);
    expect(transport.requests).toEqual([]);
  });

  test('rejects optional commands without matched properties', async () => {
    const metadata = findMetadata(
      miotAirConditionerEndpointAdapter,
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

    await expect(
      executeCommand(connection, new SetAirConditionerModeCommand('cool')),
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
        new SetAirConditionerTargetHumidityCommand(0.5),
      ),
    ).rejects.toBeInstanceOf(CommandError);
    expect(connection.targetRelativeHumidity).toBeUndefined();
    expect(transport.requests).toEqual([]);
  });

  test('matches control features without an environment service', () => {
    const spec = createAirConditionerSpec();
    spec.type = 'urn:miot-spec-v2:device:other:0000FFFF:test:1';

    spec.services = spec.services.filter(service => service.iid !== 4);
    const candidates = miotAirConditionerEndpointAdapter.findMetadataCandidates(
      {did: 'device-1', model: 'test.device'},
      spec,
    );

    expect(candidates).toHaveLength(1);

    const metadata = miotAirConditionerEndpointAdapter.resolveMetadata(
      requireMetadataCandidate(candidates),
    );

    expect(metadata.resources.map(resource => resource.service.iid)).toEqual([
      2,
    ]);
    expect(getMetadataPropertyNames(metadata)).toEqual(
      ['on', 'mode', 'targetTemperature', 'targetRelativeHumidity'].toSorted(),
    );
  });

  test.each([
    {name: 'temperature', iid: 7, remaining: 'relativeHumidity'},
    {name: 'relativeHumidity', iid: 9, remaining: 'temperature'},
  ])('matches the remaining environment feature without $name', entry => {
    const spec = createAirConditionerSpec();
    removeSpecProperty(spec, 4, entry.iid);
    const candidates = miotAirConditionerEndpointAdapter.findMetadataCandidates(
      {did: 'device-1'},
      spec,
    );

    expect(candidates).toHaveLength(1);

    const metadata = miotAirConditionerEndpointAdapter.resolveMetadata(
      requireMetadataCandidate(candidates),
    );

    expect(getMetadataPropertyNames(metadata)).toEqual(
      [
        'on',
        'mode',
        'targetTemperature',
        'targetRelativeHumidity',
        entry.remaining,
      ].toSorted(),
    );
  });

  test('combines environment features exposed by separate services', () => {
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
      temperatureEnvironment,
      relativeHumidityEnvironment,
    ];
    const candidates = miotAirConditionerEndpointAdapter.findMetadataCandidates(
      {did: 'device-1'},
      spec,
    );

    expect(candidates).toHaveLength(1);

    const metadata = miotAirConditionerEndpointAdapter.resolveMetadata(
      requireMetadataCandidate(candidates),
    );

    expect(
      metadata.resources.map(resource => resource.service.iid).toSorted(),
    ).toEqual([2, 4, 5]);
    expect(getMetadataPropertyNames(metadata)).toContain('temperature');
    expect(getMetadataPropertyNames(metadata)).toContain('relativeHumidity');
  });

  test('prefers one complete environment service over split alternatives', () => {
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
    const metadata = findMetadata(miotAirConditionerEndpointAdapter, spec);

    expect(
      metadata.resources.map(resource => resource.service.iid).toSorted(),
    ).toEqual([2, 4]);
  });

  test.each([
    'urn:miot-spec-v2:device:other:0000FFFF:test:1',
    'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-rr6r00:4',
  ])('matches complete features independently of device type (%s)', type => {
    const spec = {...createAirConditionerSpec(), type};
    const candidates = miotAirConditionerEndpointAdapter.findMetadataCandidates(
      {did: 'device-1', model: 'test.device'},
      spec,
    );

    expect(candidates).toHaveLength(1);

    const metadata = miotAirConditionerEndpointAdapter.resolveMetadata(
      requireMetadataCandidate(candidates),
    );

    expect(
      metadata.resources.map(resource => resource.service.iid).toSorted(),
    ).toEqual([2, 4]);
    expect(getMetadataPropertyNames(metadata)).toEqual(
      [
        'on',
        'mode',
        'targetTemperature',
        'targetRelativeHumidity',
        'temperature',
        'relativeHumidity',
      ].toSorted(),
    );
  });

  test('commits control and environment state atomically', () => {
    const metadata = findMetadata(
      miotAirConditionerEndpointAdapter,
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
        targetTemperature: 23,
        targetRelativeHumidity: 55,
        temperature: 24.5,
        relativeHumidity: 61,
      }),
    });

    expect(values).toEqual([
      [false, false, 0, 0, 0, 0],
      [true, true, 296.15, 0.55, 297.65, 0.61],
    ]);
    dispose();
  });
});

describe('MIoT dehumidifier capabilities', () => {
  test('matches and projects optional mode and normalized target humidity', () => {
    const metadata = findMetadata(
      miotDehumidifierEndpointAdapter,
      createDehumidifierSpec(),
    );
    const connection = new MiotDehumidifierEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );

    expect(getMetadataProperties(metadata)).toMatchObject({
      on: {iid: 1},
      mode: {iid: 2},
      targetRelativeHumidity: {iid: 3},
    });
    expect(metadata.resources).toMatchObject([
      {service: {iid: 2}},
      {
        service: {iid: 3},
        properties: {temperature: {iid: 2}, relativeHumidity: {iid: 1}},
      },
    ]);
    expect(connection.mode).toBe('auto');
    expect(connection.targetRelativeHumidity).toBe(0);
    expect(connection.temperature?.kelvin).toBe(0);
    expect(connection.relativeHumidity).toBe(0);

    updateProperty(connection, metadata, 'mode', 1);
    updateProperty(connection, metadata, 'targetRelativeHumidity', 55);
    // The MIoT step describes write precision. Devices may still report a
    // finer-grained floating-point sensor state.
    updateProperty(connection, metadata, 'temperature', 21.5);
    updateProperty(connection, metadata, 'relativeHumidity', 58);
    expect(connection.mode).toBe('sleep');
    expect(connection.targetRelativeHumidity).toBe(0.55);
    expect(connection.temperature?.celsius).toBeCloseTo(21.5);
    expect(connection.relativeHumidity).toBe(0.58);

    updateProperty(connection, metadata, 'mode', 2);
    expect(connection.mode).toBe('laundry');
    expect(() => updateProperty(connection, metadata, 'mode', 3)).toThrow(
      TypeError,
    );
  });

  test('maps modes and clamps and quantizes normalized target humidity writes', async () => {
    const metadata = findMetadata(
      miotDehumidifierEndpointAdapter,
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
      new SetDehumidifierTargetHumidityCommand(0.3),
    );
    await executeCommand(
      connection,
      new SetDehumidifierTargetHumidityCommand(0.584),
    );

    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'mode', 0),
      createExpectedRequest(metadata, 'mode', 1),
      createExpectedRequest(metadata, 'mode', 2),
      createExpectedRequest(metadata, 'targetRelativeHumidity', 30),
      createExpectedRequest(metadata, 'targetRelativeHumidity', 58),
    ]);

    await executeCommand(
      connection,
      new SetDehumidifierTargetHumidityCommand(0.29),
    );
    await executeCommand(
      connection,
      new SetDehumidifierTargetHumidityCommand(0.71),
    );

    expect(transport.requests.slice(5)).toEqual([
      createExpectedRequest(metadata, 'targetRelativeHumidity', 30),
      createExpectedRequest(metadata, 'targetRelativeHumidity', 70),
    ]);
  });

  test('returns independent canonical mode and target humidity effects', async () => {
    const metadata = findMetadata(
      miotDehumidifierEndpointAdapter,
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
        mode: 1,
        targetRelativeHumidity: 58,
        temperature: 22,
        relativeHumidity: 60,
      }),
    });

    const modeEffect = requireEffect(
      await executeCommand(connection, new SetDehumidifierModeCommand('sleep')),
    );
    const humidityEffect = requireEffect(
      await executeCommand(
        connection,
        new SetDehumidifierTargetHumidityCommand(0.584),
      ),
    );

    expect(modeEffect.matches(endpoint)).toBe(true);
    expect(
      humidityEffect.equals(
        requireEffect(
          connection.prepareCommand(
            new SetDehumidifierTargetHumidityCommand(0.581),
          ).effect,
        ),
      ),
    ).toBe(true);
    expect(humidityEffect.matches(endpoint)).toBe(true);

    updateProperty(connection, metadata, 'mode', 2);
    updateProperty(connection, metadata, 'targetRelativeHumidity', 59);
    expect(modeEffect.matches(endpoint)).toBe(false);
    expect(humidityEffect.matches(endpoint)).toBe(false);
  });

  test('rejects optional commands without matched properties', async () => {
    const metadata = findMetadata(
      miotDehumidifierEndpointAdapter,
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
    await expect(
      executeCommand(connection, new SetDehumidifierModeCommand('auto')),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      executeCommand(connection, new SetDehumidifierTargetHumidityCommand(0.5)),
    ).rejects.toBeInstanceOf(CommandError);
    expect(transport.requests).toEqual([]);
  });

  test('omits one incompatible optional feature without hiding the others', () => {
    const spec = createDehumidifierSpec();
    const modeProperty = requireSpecProperty(spec, 2);
    modeProperty['value-list'] = createValueList([0, 1, 2, 3]);
    const metadata = findMetadata(miotDehumidifierEndpointAdapter, spec);

    expect(getMetadataPropertyNames(metadata)).toEqual(
      [
        'on',
        'targetRelativeHumidity',
        'temperature',
        'relativeHumidity',
      ].toSorted(),
    );
  });

  test('matches control features without an environment service', () => {
    const spec = createDehumidifierSpec();
    spec.type = 'urn:miot-spec-v2:device:other:0000FFFF:test:1';

    spec.services = spec.services.filter(service => service.iid !== 3);
    const candidates = miotDehumidifierEndpointAdapter.findMetadataCandidates(
      {did: 'device-1', model: 'test.device'},
      spec,
    );

    expect(candidates).toHaveLength(1);

    const metadata = miotDehumidifierEndpointAdapter.resolveMetadata(
      requireMetadataCandidate(candidates),
    );

    expect(metadata.resources.map(resource => resource.service.iid)).toEqual([
      2,
    ]);
    expect(getMetadataPropertyNames(metadata)).toEqual(
      ['on', 'mode', 'targetRelativeHumidity'].toSorted(),
    );
  });

  test.each([
    {name: 'temperature', iid: 2, remaining: 'relativeHumidity'},
    {name: 'relativeHumidity', iid: 1, remaining: 'temperature'},
  ])('matches the remaining environment feature without $name', entry => {
    const spec = createDehumidifierSpec();
    removeSpecProperty(spec, 3, entry.iid);
    const candidates = miotDehumidifierEndpointAdapter.findMetadataCandidates(
      {did: 'device-1'},
      spec,
    );

    expect(candidates).toHaveLength(1);

    const metadata = miotDehumidifierEndpointAdapter.resolveMetadata(
      requireMetadataCandidate(candidates),
    );

    expect(getMetadataPropertyNames(metadata)).toEqual(
      ['on', 'mode', 'targetRelativeHumidity', entry.remaining].toSorted(),
    );
  });

  test('combines environment features exposed by separate services', () => {
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
    const candidates = miotDehumidifierEndpointAdapter.findMetadataCandidates(
      {did: 'device-1'},
      spec,
    );

    expect(candidates).toHaveLength(1);

    const metadata = miotDehumidifierEndpointAdapter.resolveMetadata(
      requireMetadataCandidate(candidates),
    );

    expect(
      metadata.resources.map(resource => resource.service.iid).toSorted(),
    ).toEqual([2, 3, 4]);
    expect(getMetadataPropertyNames(metadata)).toContain('temperature');
    expect(getMetadataPropertyNames(metadata)).toContain('relativeHumidity');
  });

  test('prefers one complete environment service over split alternatives', () => {
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
    const metadata = findMetadata(miotDehumidifierEndpointAdapter, spec);

    expect(
      metadata.resources.map(resource => resource.service.iid).toSorted(),
    ).toEqual([2, 3]);
  });

  test.each([
    'urn:miot-spec-v2:device:other:0000FFFF:test:1',
    'urn:miot-spec-v2:device:dehumidifier:0000A02D:xiaomi-13l:2',
  ])('matches complete features independently of device type (%s)', type => {
    const spec = {...createDehumidifierSpec(), type};
    const candidates = miotDehumidifierEndpointAdapter.findMetadataCandidates(
      {did: 'device-1', model: 'test.device'},
      spec,
    );

    expect(candidates).toHaveLength(1);

    const metadata = miotDehumidifierEndpointAdapter.resolveMetadata(
      requireMetadataCandidate(candidates),
    );

    expect(
      metadata.resources.map(resource => resource.service.iid).toSorted(),
    ).toEqual([2, 3]);
    expect(getMetadataPropertyNames(metadata)).toEqual(
      [
        'on',
        'mode',
        'targetRelativeHumidity',
        'temperature',
        'relativeHumidity',
      ].toSorted(),
    );
  });
});

describe('MIoT fan capabilities', () => {
  test('matches and projects wind mode, normalized speed, and swing', () => {
    const metadata = findMetadata(miotFanEndpointAdapter, createFanSpec());
    const connection = new MiotFanEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [new TestTransport()],
    );

    expect(getMetadataProperties(metadata)).toMatchObject({
      on: {iid: 1},
      windMode: {iid: 2},
      speed: {iid: 3},
      horizontalSwing: {iid: 4},
    });
    expect(connection.windMode).toBe('normal');
    expect(connection.speed).toBe(0);
    expect(connection.horizontalSwing).toBe(false);

    updateProperty(connection, metadata, 'windMode', 1);
    updateProperty(connection, metadata, 'speed', 3);
    updateProperty(connection, metadata, 'horizontalSwing', true);
    expect(connection.windMode).toBe('natural');
    expect(connection.speed).toBe(0.75);
    expect(connection.horizontalSwing).toBe(true);

    expect(() => updateProperty(connection, metadata, 'speed', 0)).toThrow(
      TypeError,
    );
  });

  test('maps wind mode, quantizes speed, and writes horizontal swing', async () => {
    const metadata = findMetadata(miotFanEndpointAdapter, createFanSpec());
    const transport = new TestTransport();
    const connection = new MiotFanEndpointConnection(
      new MiotProvider('provider'),
      metadata,
      [transport],
    );

    await executeCommand(connection, new SetFanWindModeCommand('normal'));
    await executeCommand(connection, new SetFanWindModeCommand('natural'));
    await executeCommand(connection, new SetFanSpeedCommand(0.01));
    await executeCommand(connection, new SetFanSpeedCommand(0.38));
    await executeCommand(connection, new SetFanSpeedCommand(1));
    await executeCommand(connection, new SetFanHorizontalSwingCommand(true));

    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'windMode', 0),
      createExpectedRequest(metadata, 'windMode', 1),
      createExpectedRequest(metadata, 'speed', 1),
      createExpectedRequest(metadata, 'speed', 2),
      createExpectedRequest(metadata, 'speed', 4),
      createExpectedRequest(metadata, 'horizontalSwing', true),
    ]);
  });

  test('returns independent canonical mode, speed, and swing effects', async () => {
    const metadata = findMetadata(miotFanEndpointAdapter, createFanSpec());
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
        windMode: 0,
        speed: 2,
        horizontalSwing: true,
      }),
    });

    const modeEffect = requireEffect(
      await executeCommand(connection, new SetFanWindModeCommand('normal')),
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

    updateProperty(connection, metadata, 'speed', 3);
    expect(modeEffect.matches(endpoint)).toBe(true);
    expect(speedEffect.matches(endpoint)).toBe(false);
    expect(swingEffect.matches(endpoint)).toBe(true);
  });

  test('rejects optional commands without matched properties', async () => {
    const metadata = findMetadata(
      miotFanEndpointAdapter,
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

    await expect(
      executeCommand(connection, new SetFanWindModeCommand('normal')),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      executeCommand(connection, new SetFanSpeedCommand(0.5)),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      executeCommand(connection, new SetFanHorizontalSwingCommand(true)),
    ).rejects.toBeInstanceOf(CommandError);
    expect(transport.requests).toEqual([]);
  });

  test('omits one incompatible optional feature without hiding the others', () => {
    const spec = createFanSpec();
    const speedProperty = requireSpecProperty(spec, 3);
    speedProperty['value-list'] = createValueList([1, 2, 3]);
    const metadata = findMetadata(miotFanEndpointAdapter, spec);

    expect(getMetadataPropertyNames(metadata)).toEqual(
      ['on', 'windMode', 'horizontalSwing'].toSorted(),
    );
  });

  test.each([
    'urn:miot-spec-v2:device:other:0000FFFF:test:1',
    'urn:miot-spec-v2:device:fan:0000A005:dmaker-p5c:2',
  ])('matches complete features independently of device type (%s)', type => {
    const spec = {...createFanSpec(), type};
    const candidates = miotFanEndpointAdapter.findMetadataCandidates(
      {did: 'device-1', model: 'test.device'},
      spec,
    );

    expect(candidates).toHaveLength(1);

    const metadata = miotFanEndpointAdapter.resolveMetadata(
      requireMetadataCandidate(candidates),
    );

    expect(metadata.resources.map(resource => resource.service.iid)).toEqual([
      2,
    ]);
    expect(getMetadataPropertyNames(metadata)).toEqual(
      ['on', 'windMode', 'speed', 'horizontalSwing'].toSorted(),
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
  spec.services.push(createEnvironmentService(4, 7, [-50, 150, 0.1], 9));
  return spec;
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
    createValueListProperty(
      2,
      'urn:miot-spec-v2:property:mode:00000008:test:1',
      [0, 1, 2],
    ),
    createRangeProperty(
      3,
      'urn:miot-spec-v2:property:target-humidity:00000022:test:1',
      'uint8',
      'percentage',
      [30, 70, 1],
    ),
  );
  spec.services.push(createEnvironmentService(3, 2, [-30, 100, 1], 1));
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
  adapter: MiotEndpointAdapter,
  spec: MiotSpecInstance,
): MiotEndpointConnectionResolvedMetadata {
  return adapter.resolveMetadata(findPersistedMetadata(adapter, spec));
}

function findPersistedMetadata(
  adapter: MiotEndpointAdapter,
  spec: MiotSpecInstance,
): MiotEndpointConnectionMetadata {
  const [candidate] = adapter.findMetadataCandidates(
    {did: 'device-1', model: 'test.device'},
    spec,
  );

  if (candidate === undefined) {
    throw new Error('Test adapter returned no metadata candidate.');
  }

  return candidate.metadata;
}

function requireMetadataCandidate(
  candidates: readonly {
    readonly metadata: MiotEndpointConnectionMetadata;
  }[],
): MiotEndpointConnectionMetadata {
  const [candidate] = candidates;

  if (candidate === undefined) {
    throw new Error('Test adapter returned no metadata candidate.');
  }

  return candidate.metadata;
}

function requireSpecProperty(
  spec: MiotSpecInstance,
  iid: number,
): MiotSpecProperty {
  const property = spec.services[0]?.properties?.find(item => item.iid === iid);

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
