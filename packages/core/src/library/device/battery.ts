import type {Device} from '../device.js';

export type BatteryLevelSource = Device & {
  /** Remaining battery level as a normalized ratio from 0 to 1. */
  readonly batteryLevel: number | undefined;
};
