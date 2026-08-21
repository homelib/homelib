import type {Temperature} from '../atomics/index.js';
import type {Device} from '../device.js';
import {DeviceEvent, type DeviceEventSource} from '../event.js';

export type TemperatureSource = Device & {
  readonly temperature: Temperature | undefined;
};

export type RelativeHumiditySource = Device & {
  /** Relative humidity as a normalized ratio from 0 to 1. */
  readonly relativeHumidity: number | undefined;
};

export class MotionDetectedEvent extends DeviceEvent<'motionDetected'> {
  override toLogString(): string {
    return 'motionDetected';
  }
}

export type MotionDetectionSource = Device & {
  /** Subscribes to future motion detections. */
  readonly onMotionDetected: DeviceEventSource<MotionDetectedEvent>;
  /** Whether motion is currently detected. */
  readonly motionDetected: boolean | undefined;
};

export type AmbientLightLevel = 'low' | 'high';

export type AmbientLightLevelSource = Device & {
  /** The ambient light level reported by the device. */
  readonly ambientLightLevel: AmbientLightLevel | undefined;
};
