import {TemperatureHumiditySensorEndpoint} from '@homelib/core';

import {
  createMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionMetadata,
  resolveMiotEndpointConnectionResources,
} from '../device.js';
import {
  MiotEndpointConnectionTransport,
  getMiotEndpointConnectionProperty,
} from '../endpoint-connection.js';
import type {
  MiotExecutionRequest,
  MiotExecutionResult,
  MiotSpecInstance,
  MiotSpecProperty,
  MiotSpecService,
} from '../miot/index.js';
import {MiotProvider} from '../provider.js';

import {MiotTemperatureHumiditySensorEndpointConnection} from './temperature-humidity-sensor.js';

test('matches the official temperature humidity sensor service', () => {
  const spec = createSpec();
  const resources = resolveMiotEndpointConnectionResources(
    MiotTemperatureHumiditySensorEndpointConnection,
    spec,
  );

  expect(MiotTemperatureHumiditySensorEndpointConnection.Endpoint).toBe(
    TemperatureHumiditySensorEndpoint,
  );
  expect(resources).toHaveLength(1);
  expect(resources?.[0]?.service.iid).toBe(2);
  expect(Object.keys(resources?.[0]?.properties ?? {}).toSorted()).toEqual([
    'relative-humidity',
    'temperature',
  ]);
});

test('matches temperature and humidity from an environment service', () => {
  const spec = createSpec({
    deviceType: 'urn:miot-spec-v2:device:air-monitor:0000A008:cgllc-s1:1',
    serviceType: 'urn:miot-spec-v2:service:environment:0000780A:cgllc-s1:1',
  });
  const resources = resolveMiotEndpointConnectionResources(
    MiotTemperatureHumiditySensorEndpointConnection,
    spec,
  );

  expect(resources).toHaveLength(1);
  expect(resources?.[0]).toMatchObject({
    service: {iid: 2},
    properties: {
      temperature: {iid: 1},
      'relative-humidity': {iid: 2},
    },
  });
});

test.each([
  'urn:miot-spec-v2:property:temperature:00000020:lumi-agl02:1',
  'urn:miot-spec-v2:property:relative-humidity:0000000C:lumi-agl02:1',
])('requires property %s', propertyType => {
  const spec = createSpec();
  const service = requireService(spec, 2);
  service.properties = service.properties?.filter(
    property => property.type !== propertyType,
  );

  expect(
    resolveMiotEndpointConnectionResources(
      MiotTemperatureHumiditySensorEndpointConnection,
      spec,
    ),
  ).toBeUndefined();
});

test('fails closed with multiple relevant services', () => {
  const spec = createSpec();
  spec.services.push({
    ...createSensorService(
      'urn:miot-spec-v2:service:environment:0000780A:cgllc-s1:1',
    ),
    iid: 4,
  });

  expect(
    resolveMiotEndpointConnectionResources(
      MiotTemperatureHumiditySensorEndpointConnection,
      spec,
    ),
  ).toBeUndefined();
});

test('reads temperature and relative humidity from MIoT state', () => {
  const spec = createSpec();
  const resources = resolveMiotEndpointConnectionResources(
    MiotTemperatureHumiditySensorEndpointConnection,
    spec,
  );

  if (resources === undefined) {
    throw new Error('Test sensor did not resolve endpoint resources.');
  }

  const persistedMetadata = createMiotEndpointConnectionMetadata(
    {did: 'sensor-1', model: 'lumi.sensor_ht.agl02'},
    spec.type,
    resources,
  );
  const metadata = resolveMiotEndpointConnectionMetadata(
    MiotTemperatureHumiditySensorEndpointConnection,
    persistedMetadata,
  );
  const connection = new MiotTemperatureHumiditySensorEndpointConnection(
    new MiotProvider('provider'),
    metadata,
    [new TestTransport()],
  );
  const temperature = getMiotEndpointConnectionProperty(
    metadata,
    'temperature',
  );
  const relativeHumidity = getMiotEndpointConnectionProperty(
    metadata,
    'relative-humidity',
  );

  expect(persistedMetadata.resources).toEqual([
    {service: expect.objectContaining({iid: 2})},
  ]);
  expect(persistedMetadata.resources[0]).not.toHaveProperty('properties');
  expect(connection.stateProperties).toHaveLength(2);

  connection.handleStateUpdate({
    did: metadata.device.did,
    online: true,
    properties: [
      {
        did: metadata.device.did,
        siid: temperature.service.iid,
        piid: temperature.property.iid,
        value: 23.25,
      },
      {
        did: metadata.device.did,
        siid: relativeHumidity.service.iid,
        piid: relativeHumidity.property.iid,
        value: 52.5,
      },
    ],
  });

  expect(connection.ready).toBe(true);
  expect(connection.temperature.celsius).toBe(23.25);
  expect(connection.relativeHumidity).toBe(0.525);
});

function createSpec(
  options: {
    readonly deviceType?: string;
    readonly serviceType?: string;
  } = {},
): MiotSpecInstance {
  return {
    type:
      options.deviceType ??
      'urn:miot-spec-v2:device:temperature-humidity-sensor:0000A00A:lumi-agl02:1',
    description: 'Temperature Humidity Sensor',
    services: [
      createSensorService(options.serviceType),
      createBatteryService(),
    ],
  };
}

function createSensorService(type?: string): MiotSpecService {
  return {
    iid: 2,
    type:
      type ??
      'urn:miot-spec-v2:service:temperature-humidity-sensor:00007814:lumi-agl02:1',
    description: 'Temperature Humidity Sensor',
    properties: [
      createSensorProperty(
        1,
        'urn:miot-spec-v2:property:temperature:00000020:lumi-agl02:1',
        'celsius',
        [-40, 125, 0.01],
      ),
      createSensorProperty(
        2,
        'urn:miot-spec-v2:property:relative-humidity:0000000C:lumi-agl02:1',
        'percentage',
        [0, 100, 0.01],
      ),
      createSensorProperty(
        3,
        'urn:miot-spec-v2:property:pressure:00000012:lumi-agl02:1',
        'pa',
        [30_000, 110_000, 1],
      ),
    ],
  };
}

function createSensorProperty(
  iid: number,
  type: string,
  unit: string,
  valueRange: [number, number, number],
): MiotSpecProperty {
  return {
    iid,
    type,
    description: type,
    format: 'float',
    access: ['read', 'notify'],
    unit,
    'value-range': valueRange,
  };
}

function createBatteryService(): MiotSpecService {
  return {
    iid: 3,
    type: 'urn:miot-spec-v2:service:battery:00007805:lumi-agl02:1',
    description: 'Battery',
    properties: [
      createSensorProperty(
        1,
        'urn:miot-spec-v2:property:battery-level:00000014:lumi-agl02:1',
        'percentage',
        [0, 100, 1],
      ),
    ],
  };
}

function requireService(spec: MiotSpecInstance, iid: number): MiotSpecService {
  const service = spec.services.find(candidate => candidate.iid === iid);

  if (service === undefined) {
    throw new Error(`Test spec has no service ${iid}.`);
  }

  return service;
}

class TestTransport extends MiotEndpointConnectionTransport {
  override executeRequest(
    _request: MiotExecutionRequest,
  ): Promise<MiotExecutionResult> {
    throw new TypeError('Sensor transport does not execute commands.');
  }
}
