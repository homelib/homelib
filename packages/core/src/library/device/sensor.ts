import type {Temperature} from '../atomics/index.js';
import type {Device} from '../device.js';

export type TemperatureSource = Device & {
  readonly temperature: Temperature | undefined;
};

export type RelativeHumiditySource = Device & {
  /** Relative humidity as a normalized ratio from 0 to 1. */
  readonly relativeHumidity: number | undefined;
};

export type MotionDetectionSource = Device & {
  /** Whether motion is currently detected. */
  readonly motionDetected: boolean | undefined;
};

export type AmbientLightLevel = 'low' | 'high';

export type AmbientLightLevelSource = Device & {
  /** The ambient light level reported by the device. */
  readonly ambientLightLevel: AmbientLightLevel | undefined;
};
