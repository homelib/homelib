import type {Endpoint} from '@project-chip/matter.js/device';

import type {UnknownConfigDeclarations} from '../config.js';
import type {UnknownNamedObject} from '../types.js';
import {types} from '../types.js';

import type {DeviceEndpoint} from './device-endpoint.js';

export type DeviceOptions = {
  configs: UnknownConfigDeclarations;
};

export abstract class Device<TDeviceEndpoint extends DeviceEndpoint>
  implements UnknownNamedObject
{
  declare [types]: {
    name: string;
  };

  abstract readonly type: string;

  readonly options: DeviceOptions;

  constructor(
    readonly name: string,
    options: Partial<DeviceOptions> = {},
  ) {
    const {configs = {}} = options;

    this.options = {configs};
  }

  configs(configs: UnknownConfigDeclarations): this {
    this.options.configs = configs;
    return this;
  }

  abstract connect(
    endpoint: Endpoint,
  ): Promise<TDeviceEndpoint> | TDeviceEndpoint;
}

export type UnknownDevice = Device<DeviceEndpoint>;

export type DeviceConstructor<TDeviceEndpoint extends DeviceEndpoint> =
  typeof Device<TDeviceEndpoint>;

export type UnknownDeviceConstructor = typeof Device<DeviceEndpoint>;
