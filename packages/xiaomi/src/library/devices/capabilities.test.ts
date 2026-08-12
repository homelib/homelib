import {
  CommandError,
  SetAirConditionerModeCommand,
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
  MiotEndpointConnectionTransport,
  getMiotEndpointConnectionProperty,
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
  test('matches and projects optional mode and target temperature', () => {
    const metadata = findMetadata(
      miotAirConditionerEndpointAdapter,
      createAirConditionerSpec(),
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
    });
    expect(metadata.resources).toMatchObject([
      {service: {iid: 2}},
      {
        service: {iid: 4},
        properties: {temperature: {iid: 7}, humidity: {iid: 9}},
      },
    ]);
    expect(connection.stateProperties).toHaveLength(5);
    expect(connection.mode).toBe('cool');
    expect(connection.targetTemperature?.kelvin).toBe(0);
    expect(connection.temperature?.kelvin).toBe(0);
    expect(connection.humidity).toBe(0);

    updateProperty(connection, metadata, 'mode', 2);
    updateProperty(connection, metadata, 'targetTemperature', 23);
    updateProperty(connection, metadata, 'temperature', 24.5);
    updateProperty(connection, metadata, 'humidity', 61);
    expect(connection.mode).toBe('cool');
    expect(connection.targetTemperature?.celsius).toBeCloseTo(23);
    expect(connection.temperature?.celsius).toBeCloseTo(24.5);
    expect(connection.humidity).toBe(0.61);

    updateProperty(connection, metadata, 'mode', 5);
    expect(connection.mode).toBe('heat');
    expect(() => updateProperty(connection, metadata, 'mode', 1)).toThrow(
      TypeError,
    );
  });

  test('maps modes and quantizes target temperature writes', async () => {
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

    await connection.processCommand(new SetAirConditionerModeCommand('cool'));
    await connection.processCommand(new SetAirConditionerModeCommand('dry'));
    await connection.processCommand(new SetAirConditionerModeCommand('fan'));
    await connection.processCommand(new SetAirConditionerModeCommand('heat'));
    await connection.processCommand(
      new SetAirConditionerTargetTemperatureCommand(
        Temperature.fromCelsius(23.6),
      ),
    );

    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'mode', 2),
      createExpectedRequest(metadata, 'mode', 3),
      createExpectedRequest(metadata, 'mode', 4),
      createExpectedRequest(metadata, 'mode', 5),
      createExpectedRequest(metadata, 'targetTemperature', 23.5),
    ]);

    await expect(
      connection.processCommand(new SetAirConditionerModeCommand('auto')),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      connection.processCommand(
        new SetAirConditionerTargetTemperatureCommand(
          Temperature.fromCelsius(31.5),
        ),
      ),
    ).rejects.toBeInstanceOf(CommandError);
    expect(transport.requests).toHaveLength(5);
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

    await connection.processCommand(new SetAirConditionerModeCommand('heat'));

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

    expect(getMetadataProperties(metadata).mode).toBeUndefined();
    await expect(
      connection.processCommand(new SetAirConditionerModeCommand('cool')),
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
      connection.processCommand(new SetAirConditionerModeCommand('cool')),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      connection.processCommand(
        new SetAirConditionerTargetTemperatureCommand(
          Temperature.fromCelsius(24),
        ),
      ),
    ).rejects.toBeInstanceOf(CommandError);
    expect(transport.requests).toEqual([]);
  });

  test('does not fall back for the known model when environment is missing', () => {
    const spec = createAirConditionerSpec();

    spec.services = spec.services.filter(service => service.iid !== 4);

    expect(
      miotAirConditionerEndpointAdapter.findMetadataCandidates(
        {did: 'device-1', model: 'test.device'},
        spec,
      ),
    ).toEqual([]);
  });

  test('keeps unknown air conditioner models on the on-only fallback', () => {
    for (const type of [
      'urn:miot-spec-v2:device:air-conditioner:0000A004:other:1',
      'urn:miot-spec-v2:device:air-conditioner:0000A004:xiaomi-rr6r00:4',
    ]) {
      const spec = {...createAirConditionerSpec(), type};
      const metadata = findMetadata(miotAirConditionerEndpointAdapter, spec);

      expect(Object.keys(getMetadataProperties(metadata))).toEqual(['on']);
      expect(metadata.resources).toHaveLength(1);

      const connection = new MiotAirConditionerEndpointConnection(
        new MiotProvider('provider'),
        metadata,
        [new TestTransport()],
      );

      expect(connection.temperature).toBeUndefined();
      expect(connection.humidity).toBeUndefined();
    }
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
        temperature: number,
        humidity: number | undefined,
      ]
    > = [];
    const dispose = autorun(() => {
      values.push([
        connection.ready,
        connection.on,
        connection.targetTemperature?.kelvin ?? Number.NaN,
        connection.temperature?.kelvin ?? Number.NaN,
        connection.humidity,
      ]);
    });

    connection.handleStateUpdate({
      did: metadata.device.did,
      online: true,
      properties: createStateProperties(metadata, {
        on: true,
        mode: 2,
        targetTemperature: 23,
        temperature: 24.5,
        humidity: 61,
      }),
    });

    expect(values).toEqual([
      [false, false, 0, 0, 0],
      [true, true, 296.15, 297.65, 0.61],
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
      targetHumidity: {iid: 3},
    });
    expect(metadata.resources).toMatchObject([
      {service: {iid: 2}},
      {
        service: {iid: 3},
        properties: {temperature: {iid: 2}, humidity: {iid: 1}},
      },
    ]);
    expect(connection.mode).toBe('auto');
    expect(connection.targetHumidity).toBe(0);
    expect(connection.temperature?.kelvin).toBe(0);
    expect(connection.humidity).toBe(0);

    updateProperty(connection, metadata, 'mode', 1);
    updateProperty(connection, metadata, 'targetHumidity', 55);
    // The MIoT step describes write precision. Devices may still report a
    // finer-grained floating-point sensor state.
    updateProperty(connection, metadata, 'temperature', 21.5);
    updateProperty(connection, metadata, 'humidity', 58);
    expect(connection.mode).toBe('sleep');
    expect(connection.targetHumidity).toBe(0.55);
    expect(connection.temperature?.celsius).toBeCloseTo(21.5);
    expect(connection.humidity).toBe(0.58);

    updateProperty(connection, metadata, 'mode', 2);
    expect(connection.mode).toBe('laundry');
    expect(() => updateProperty(connection, metadata, 'mode', 3)).toThrow(
      TypeError,
    );
  });

  test('maps modes and quantizes normalized target humidity writes', async () => {
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

    await connection.processCommand(new SetDehumidifierModeCommand('auto'));
    await connection.processCommand(new SetDehumidifierModeCommand('sleep'));
    await connection.processCommand(new SetDehumidifierModeCommand('laundry'));
    await connection.processCommand(
      new SetDehumidifierTargetHumidityCommand(0.3),
    );
    await connection.processCommand(
      new SetDehumidifierTargetHumidityCommand(0.584),
    );

    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'mode', 0),
      createExpectedRequest(metadata, 'mode', 1),
      createExpectedRequest(metadata, 'mode', 2),
      createExpectedRequest(metadata, 'targetHumidity', 30),
      createExpectedRequest(metadata, 'targetHumidity', 58),
    ]);

    await expect(
      connection.processCommand(new SetDehumidifierTargetHumidityCommand(0.29)),
    ).rejects.toBeInstanceOf(CommandError);
    expect(transport.requests).toHaveLength(5);
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
    expect(connection.targetHumidity).toBeUndefined();
    await expect(
      connection.processCommand(new SetDehumidifierModeCommand('auto')),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      connection.processCommand(new SetDehumidifierTargetHumidityCommand(0.5)),
    ).rejects.toBeInstanceOf(CommandError);
    expect(transport.requests).toEqual([]);
  });

  test('does not fall back for the known model when environment is missing', () => {
    const spec = createDehumidifierSpec();

    spec.services = spec.services.filter(service => service.iid !== 3);

    expect(
      miotDehumidifierEndpointAdapter.findMetadataCandidates(
        {did: 'device-1', model: 'test.device'},
        spec,
      ),
    ).toEqual([]);
  });

  test('keeps unknown dehumidifier models on the on-only fallback', () => {
    for (const type of [
      'urn:miot-spec-v2:device:dehumidifier:0000A02D:other:1',
      'urn:miot-spec-v2:device:dehumidifier:0000A02D:xiaomi-13l:2',
    ]) {
      const spec = {...createDehumidifierSpec(), type};
      const metadata = findMetadata(miotDehumidifierEndpointAdapter, spec);

      expect(Object.keys(getMetadataProperties(metadata))).toEqual(['on']);
      expect(metadata.resources).toHaveLength(1);

      const connection = new MiotDehumidifierEndpointConnection(
        new MiotProvider('provider'),
        metadata,
        [new TestTransport()],
      );

      expect(connection.temperature).toBeUndefined();
      expect(connection.humidity).toBeUndefined();
    }
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

    await connection.processCommand(new SetFanWindModeCommand('normal'));
    await connection.processCommand(new SetFanWindModeCommand('natural'));
    await connection.processCommand(new SetFanSpeedCommand(0.01));
    await connection.processCommand(new SetFanSpeedCommand(0.38));
    await connection.processCommand(new SetFanSpeedCommand(1));
    await connection.processCommand(new SetFanHorizontalSwingCommand(true));

    expect(transport.requests).toEqual([
      createExpectedRequest(metadata, 'windMode', 0),
      createExpectedRequest(metadata, 'windMode', 1),
      createExpectedRequest(metadata, 'speed', 1),
      createExpectedRequest(metadata, 'speed', 2),
      createExpectedRequest(metadata, 'speed', 4),
      createExpectedRequest(metadata, 'horizontalSwing', true),
    ]);
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
      connection.processCommand(new SetFanWindModeCommand('normal')),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      connection.processCommand(new SetFanSpeedCommand(0.5)),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      connection.processCommand(new SetFanHorizontalSwingCommand(true)),
    ).rejects.toBeInstanceOf(CommandError);
    expect(transport.requests).toEqual([]);
  });

  test('keeps unknown fan models on the on-only fallback', () => {
    for (const type of [
      'urn:miot-spec-v2:device:fan:0000A005:other:1',
      'urn:miot-spec-v2:device:fan:0000A005:dmaker-p5c:2',
    ]) {
      const spec = {...createFanSpec(), type};
      const metadata = findMetadata(miotFanEndpointAdapter, spec);

      expect(Object.keys(getMetadataProperties(metadata))).toEqual(['on']);
    }
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
  humidityIid: number,
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
          humidityIid,
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

function updateProperty(
  connection: MiotEndpointConnection<never>,
  metadata: MiotEndpointConnectionMetadata,
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
  metadata: MiotEndpointConnectionMetadata,
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

function getMetadataProperties(
  metadata: MiotEndpointConnectionMetadata,
): Readonly<Record<string, MiotSpecProperty>> {
  return Object.assign(
    {},
    ...metadata.resources.map(resource => resource.properties),
  ) as Readonly<Record<string, MiotSpecProperty>>;
}

function createStateProperties(
  metadata: MiotEndpointConnectionMetadata,
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
