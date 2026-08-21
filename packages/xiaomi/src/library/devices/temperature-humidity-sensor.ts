import {
  type CommandExecution,
  Temperature,
  TemperatureHumiditySensorEndpoint,
  type TemperatureHumiditySensorEndpointConnection,
} from '@homelib/core';
import {computed} from 'mobx';

import {MiotEndpointConnection} from '../endpoint-connection/index.js';
import type {MiotPropertySchema} from '../miot/index.js';

export class MiotTemperatureHumiditySensorEndpointConnection
  extends MiotEndpointConnection<
    never,
    typeof MiotTemperatureHumiditySensorEndpointConnection.properties
  >
  implements TemperatureHumiditySensorEndpointConnection
{
  static readonly Endpoint = TemperatureHumiditySensorEndpoint;
  static readonly properties = {
    'urn:miot-spec-v2:service:temperature-humidity-sensor:00007814,urn:miot-spec-v2:service:environment:0000780A':
      {
        'urn:miot-spec-v2:property:temperature:00000020': 'temperature',
        'urn:miot-spec-v2:property:relative-humidity:0000000C':
          'relative-humidity',
      },
  } as const satisfies MiotPropertySchema;

  @computed
  get temperature(): Temperature {
    return this.getTemperaturePropertyState(
      'temperature',
      Temperature.fromKelvin(0),
    );
  }

  @computed
  get relativeHumidity(): number {
    return this.getNumberPropertyState('relative-humidity', 0) / 100;
  }

  override prepareCommand(_command: never): CommandExecution {
    throw new TypeError(
      'MIoT temperature humidity sensor does not support commands.',
    );
  }
}
