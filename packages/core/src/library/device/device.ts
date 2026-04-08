import type {NamedObject} from '@homelib/x';
import {types, x} from '@homelib/x';

import type {UnknownConfigDeclarations} from '../config.js';
import type {Scope} from '../scope.js';

import type {DeviceEndpoint} from './device-endpoint.js';

export type DeviceOptions = {
  configs: UnknownConfigDeclarations;
};

export abstract class Device<
  TDeviceEndpoint extends DeviceEndpoint,
> implements NamedObject<string> {
  declare [types]: {
    name: string;
    endpoint: TDeviceEndpoint;
  };

  abstract get type(): string;

  readonly options: DeviceOptions;

  _scope: Scope | undefined;

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

  _requireScope(): Scope {
    const scope = this._scope;

    if (!scope) {
      throw new Error('Device not added to a scope.');
    }

    return scope;
  }
}

export type UnknownDevice = Device<DeviceEndpoint>;

export type DeviceConstructor<TDeviceEndpoint extends DeviceEndpoint> =
  typeof Device<TDeviceEndpoint>;

export type UnknownDeviceConstructor = typeof Device<DeviceEndpoint>;
