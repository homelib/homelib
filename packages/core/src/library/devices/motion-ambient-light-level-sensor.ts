import {computed} from 'mobx';

import type {
  AmbientLightLevel,
  AmbientLightLevelSource,
  MotionDetectionSource,
} from '../device/index.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';
import type {DeviceEvent} from '../event.js';

export class MotionAmbientLightLevelSensor
  extends Device
  implements MotionDetectionSource, AmbientLightLevelSource
{
  protected readonly endpoint: MotionAmbientLightLevelSensorEndpoint;

  /** Subscribes to future motion detections. */
  readonly onMotionDetected: DeviceEvent;

  /** Whether motion is currently detected. */
  @computed
  get motionDetected(): boolean | undefined {
    return this.endpoint.motionDetected;
  }

  /**
   * The ambient light level observed for the current motion detection.
   * Undefined unless {@link motionDetected} is true.
   */
  @computed
  get ambientLightLevel(): AmbientLightLevel | undefined {
    return this.endpoint.ambientLightLevel;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(
      MotionAmbientLightLevelSensorEndpoint,
    );
    this.onMotionDetected = this.endpoint.onMotionDetected;
  }
}

export class MotionAmbientLightLevelSensorEndpoint<
  TConnection extends MotionAmbientLightLevelSensorEndpointConnection =
    MotionAmbientLightLevelSensorEndpointConnection,
> extends Endpoint<never, TConnection> {
  /** Subscribes to future motion detections. */
  readonly onMotionDetected = this.bindEvent(
    'motionDetected',
    connection => connection.onMotionDetected,
  );

  /** Whether motion is currently detected. */
  @computed
  get motionDetected(): boolean | undefined {
    return this.connection?.motionDetected;
  }

  /**
   * The ambient light level observed for the current motion detection.
   * Undefined unless {@link motionDetected} is true.
   */
  @computed
  get ambientLightLevel(): AmbientLightLevel | undefined {
    if (this.motionDetected !== true) {
      return undefined;
    }

    return this.connection?.ambientLightLevel;
  }

  protected override get logState(): EndpointLogState {
    if (!this.ready) {
      return {ready: false};
    }

    return {
      ready: true,
      motionDetected: this.motionDetected,
      ambientLightLevel: this.ambientLightLevel,
    };
  }
}

export type MotionAmbientLightLevelSensorEndpointConnection =
  EndpointConnection<never> & {
    readonly onMotionDetected: DeviceEvent;
    /** Whether motion is currently detected. */
    readonly motionDetected: boolean | undefined;
    /**
     * The ambient light level supplied by the provider. The endpoint exposes
     * it only while {@link motionDetected} is true.
     */
    readonly ambientLightLevel: AmbientLightLevel | undefined;
  };
