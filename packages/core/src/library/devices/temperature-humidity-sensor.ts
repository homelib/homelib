import {computed} from 'mobx';

import type {Temperature} from '../atomics/index.js';
import type {HumiditySensor, TemperatureSensor} from '../device/index.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';

export class TemperatureHumiditySensor
  extends Device
  implements TemperatureSensor, HumiditySensor
{
  protected readonly endpoint: TemperatureHumiditySensorEndpoint;

  @computed
  get temperature(): Temperature | undefined {
    return this.endpoint.temperature;
  }

  /** Relative humidity as a normalized ratio from 0 to 1. */
  @computed
  get relativeHumidity(): number | undefined {
    return this.endpoint.relativeHumidity;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(TemperatureHumiditySensorEndpoint);
  }
}

export class TemperatureHumiditySensorEndpoint<
  TConnection extends TemperatureHumiditySensorEndpointConnection =
    TemperatureHumiditySensorEndpointConnection,
> extends Endpoint<never, TConnection> {
  @computed
  get temperature(): Temperature | undefined {
    return this.connection?.temperature;
  }

  /** Relative humidity as a normalized ratio from 0 to 1. */
  @computed
  get relativeHumidity(): number | undefined {
    return this.connection?.relativeHumidity;
  }

  protected override get logState(): EndpointLogState {
    if (!this.ready) {
      return {ready: false};
    }

    return {
      ready: true,
      temperatureCelsius: this.temperature?.celsius,
      relativeHumidity: this.relativeHumidity,
    };
  }
}

export type TemperatureHumiditySensorEndpointConnection =
  EndpointConnection<never> & {
    temperature: Temperature | undefined;
    relativeHumidity: number | undefined;
  };
