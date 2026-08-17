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

export class MotionAmbientLightLevelSensor
  extends Device
  implements MotionDetectionSource, AmbientLightLevelSource
{
  protected readonly endpoint: MotionAmbientLightLevelSensorEndpoint;

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
  }
}

export class MotionAmbientLightLevelSensorEndpoint<
  TConnection extends MotionAmbientLightLevelSensorEndpointConnection =
    MotionAmbientLightLevelSensorEndpointConnection,
> extends Endpoint<never, TConnection> {
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
    /** Whether motion is currently detected. */
    readonly motionDetected: boolean | undefined;
    /**
     * The ambient light level supplied by the provider. The endpoint exposes
     * it only while {@link motionDetected} is true.
     */
    readonly ambientLightLevel: AmbientLightLevel | undefined;
  };
