import {action, observable} from 'mobx';

import {Temperature} from '../../atomics/index.js';
import {DeviceEntry} from '../../device.js';
import {
  TemperatureHumiditySensor,
  TemperatureHumiditySensorEndpoint,
  type TemperatureHumiditySensorEndpointConnection,
} from '../../devices/temperature-humidity-sensor.js';
import type {CommandExecution} from '../../endpoint.js';
import {
  type EndpointStateLogEvent,
  addLogListener,
  setEndpointLogTarget,
} from '../../log.js';

test('exposes temperature and relative humidity from one endpoint', () => {
  const entry = new DeviceEntry('sensor');
  const sensor = entry.createInstance(TemperatureHumiditySensor);
  const endpoint = entry.getEndpoint();

  expect(sensor.ready).toBe(false);
  expect(sensor.temperature).toBeUndefined();
  expect(sensor.relativeHumidity).toBeUndefined();

  if (!(endpoint instanceof TemperatureHumiditySensorEndpoint)) {
    throw new Error('Expected a temperature humidity sensor endpoint.');
  }

  const connection = new TestTemperatureHumiditySensorEndpointConnection();
  const logEvents: EndpointStateLogEvent[] = [];
  const removeLogListener = addLogListener(event => {
    if (event.type === 'endpoint-state') {
      logEvents.push(event);
    }
  });

  try {
    setEndpointLogTarget(endpoint, {
      scopePath: ['home', 'room'],
      deviceName: 'sensor',
      endpointName: '',
    });
    endpoint.bindConnection(connection);
    connection.initialize(Temperature.fromCelsius(23.25), 0.52);

    expect(sensor.ready).toBe(true);
    expect(sensor.temperature?.celsius).toBe(23.25);
    expect(sensor.relativeHumidity).toBe(0.52);
    expect(logEvents.map(event => event.state)).toEqual([
      {ready: false},
      {
        ready: true,
        temperatureCelsius: 23.25,
        relativeHumidity: 0.52,
      },
    ]);
  } finally {
    removeLogListener();
  }
});

class TestTemperatureHumiditySensorEndpointConnection implements TemperatureHumiditySensorEndpointConnection {
  @observable accessor ready = false;

  @observable accessor stateRevision = 0;

  @observable accessor temperature: Temperature | undefined;

  @observable accessor relativeHumidity: number | undefined;

  @action
  initialize(temperature: Temperature, relativeHumidity: number): void {
    this.temperature = temperature;
    this.relativeHumidity = relativeHumidity;
    this.stateRevision++;
    this.ready = true;
  }

  prepareCommand(_command: never): CommandExecution {
    throw new TypeError(
      'Temperature humidity sensors do not support commands.',
    );
  }
}
