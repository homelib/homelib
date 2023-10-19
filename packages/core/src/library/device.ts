import type {UnknownConfigDeclarations} from './config.js';
import type {NamedObject, UnknownNamedObject} from './types.js';
import {types} from './types.js';

export const device_type = Symbol('device type');

export type DeviceOptions = {
  configurations: UnknownConfigDeclarations;
};

export abstract class Device implements UnknownNamedObject {
  abstract [device_type]: string;

  declare [types]: {
    name: string;
  };

  readonly options: DeviceOptions;

  constructor(
    readonly name: string,
    options: Partial<DeviceOptions> = {},
  ) {
    const {configurations: configurations = {}} = options;

    this.options = {configurations};
  }

  configurations(configurations: UnknownConfigDeclarations): this {
    this.options.configurations = configurations;
    return this;
  }
}

export type DeviceConstructor = typeof Device;
