import type {UnknownConfigDeclarations} from '../config.js';
import type {
  DeviceDeclarationsToDeviceBindings,
  UnknownDeviceDeclarations,
} from '../device/index.js';
import type {Scope} from '../scope.js';
import type {NamedObject} from '../types.js';
import {types} from '../types.js';
import {$constructor} from '../utils/index.js';

export abstract class Card implements NamedObject<string> {
  declare [types]: {
    name: string;
    scope: Scope;
    devices: {};
    configs: {};
  };

  readonly name: this[types]['name'];

  constructor(name: string, component: string) {
    this.name = name;
  }

  devices<const TDeviceDeclarations extends UnknownDeviceDeclarations>(
    devices: TDeviceDeclarations,
  ): this & {
    [types]: {
      devices: TDeviceDeclarations;
    };
  };
  devices(devices: UnknownDeviceDeclarations): this {
    return this;
  }

  configs<const TConfigDeclarations extends UnknownConfigDeclarations>(
    configs: TConfigDeclarations,
  ): this & {
    [types]: {
      configs: TConfigDeclarations;
    };
  };
  configs(configs: UnknownConfigDeclarations): this {
    return this;
  }

  bind<TScope extends Scope>(
    devices: DeviceDeclarationsToDeviceBindings<this[types]['devices'], TScope>,
  ): this & {
    [types]: {
      scope: TScope;
    };
  } {
    throw new Error('Not implemented');
  }
}
