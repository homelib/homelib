import type {NamedObject, x} from '@homelib/x';
import {types} from '@homelib/x';

import type {UnknownConfigDeclarations} from '../config.js';
import type {Scope} from '../scope.js';

export type DeviceOptions = {
  configs: UnknownConfigDeclarations;
};

export abstract class Device implements NamedObject<string> {
  declare [types]: {
    name: string;
  };

  abstract readonly type: string;

  readonly options: DeviceOptions;

  _scope: Scope | undefined;

  _key: DeviceKey | undefined;

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

export type DeviceKey = x.Nominal<'device key', string>;

export type DeviceConstructor = typeof Device;
