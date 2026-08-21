import {computed} from 'mobx';

import type {
  MotionDetectedEvent,
  MotionDetectionSource,
} from '../device/index.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';
import type {DeviceEventSource} from '../event.js';

export class MotionSensor extends Device implements MotionDetectionSource {
  protected readonly endpoint: MotionSensorEndpoint;

  /** Subscribes to future motion detections. */
  readonly onMotionDetected: DeviceEventSource<MotionDetectedEvent>;

  /** Whether motion is currently detected. */
  @computed
  get motionDetected(): boolean | undefined {
    return this.endpoint.motionDetected;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(MotionSensorEndpoint);
    this.onMotionDetected = this.endpoint.onMotionDetected;
  }
}

export class MotionSensorEndpoint<
  TConnection extends MotionSensorEndpointConnection =
    MotionSensorEndpointConnection,
> extends Endpoint<never, TConnection> {
  /** Subscribes to future motion detections. */
  readonly onMotionDetected = this.bindEvent(
    connection => connection.onMotionDetected,
  );

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
  readonly onMotionDetected: DeviceEventSource<MotionDetectedEvent>;
  /** Whether motion is currently detected. */
  readonly motionDetected: boolean | undefined;
};
