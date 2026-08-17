import {computed} from 'mobx';

import type {MotionDetectionSource} from '../device/index.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';

export class MotionSensor extends Device implements MotionDetectionSource {
  protected readonly endpoint: MotionSensorEndpoint;

  /** Whether motion is currently detected. */
  @computed
  get motionDetected(): boolean | undefined {
    return this.endpoint.motionDetected;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(MotionSensorEndpoint);
  }
}

export class MotionSensorEndpoint<
  TConnection extends MotionSensorEndpointConnection =
    MotionSensorEndpointConnection,
> extends Endpoint<never, TConnection> {
  /** Whether motion is currently detected. */
  @computed
  get motionDetected(): boolean | undefined {
    return this.connection?.motionDetected;
  }

  protected override get logState(): EndpointLogState {
    if (!this.ready) {
      return {ready: false};
    }

    return {
      ready: true,
      motionDetected: this.motionDetected,
    };
  }
}

export type MotionSensorEndpointConnection = EndpointConnection<never> & {
  /** Whether motion is currently detected. */
  readonly motionDetected: boolean | undefined;
};
