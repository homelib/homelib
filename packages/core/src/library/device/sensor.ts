import type {Temperature} from '../atomics/index.js';
import type {Device} from '../device.js';

export type TemperatureSensor = Device & {
  readonly temperature: Temperature | undefined;
};

export type HumiditySensor = Device & {
  /** Relative humidity as a normalized ratio from 0 to 1. */
  readonly relativeHumidity: number | undefined;
};
