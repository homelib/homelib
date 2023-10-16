import type {Configurable} from './configuration.js';

export type DeviceOptions = {
  configurable: Configurable;
};

export abstract class Device {
  constructor(
    readonly name: string,
    readonly options: DeviceOptions,
  ) {}

  configurable(configurable: Configurable): this {
    this.options.configurable = configurable;
    return this;
  }
}
