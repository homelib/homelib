import type {Temperature} from '../atomics/index.js';

export type TemperatureSensor = {
  readonly temperature: Temperature | undefined;
};

export type HumiditySensor = {
  /** Relative humidity as a normalized ratio from 0 to 1. */
  readonly humidity: number | undefined;
};
