import type {ConfigDeclarationsConstraint} from './config.js';
import {types} from './types.js';

export type DeviceOptions = {
  configurations: ConfigDeclarationsConstraint;
};

export abstract class Device<TType extends string = string> {
  declare [types]: {
    type: TType;
  };

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

export type DeviceConstructor = typeof Device<string>;

export type DevicesConstraint = Record<string, Device>;
