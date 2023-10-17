import type {ConfigDeclarationsConstraint} from './config.js';

export type DeviceOptions = {
  configurations: ConfigDeclarationsConstraint;
};

export abstract class Device {
  readonly options: DeviceOptions;

  constructor(
    readonly name: string,
    options: Partial<DeviceOptions> = {},
  ) {
    const {configurations: configurations = {}} = options;

    this.options = {configurations};
  }

  configurations(configurations: ConfigDeclarationsConstraint): this {
    this.options.configurations = configurations;
    return this;
  }
}

export type DeviceConstructor = typeof Device;

export type DevicesConstraint = Record<string, Device>;
