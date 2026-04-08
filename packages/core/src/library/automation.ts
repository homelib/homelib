import type {NamedObject} from '@homelib/x';
import {types} from '@homelib/x';

import type {
  ConfigDeclarationsToConfigs,
  UnknownConfigDeclarations,
} from './config.js';
import type {
  DeviceDeclarationsToDeviceBindings,
  DeviceDeclarationsToDeviceEndpoints,
  UnknownDeviceDeclarations,
} from './device/index.js';
import type {DeviceQuery} from './device-query.js';
import type {Scope} from './scope.js';
import {$constructor} from './utils/index.js';

export abstract class Automation implements NamedObject<string> {
  declare [types]: {
    name: string;
    scope: Scope;
    devices: {};
    configs: {};
  };

  readonly name: this[types]['name'];

  constructor(name: string) {
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

  start(callback: (context: AutomationCallbackContext<this>) => void): this {
    throw new Error('Not implemented');
  }

  react(callback: (context: AutomationCallbackContext<this>) => void): this {
    throw new Error('Not implemented');
  }

  schedule(
    cronExpression: string | string[],
    callback: (context: AutomationCallbackContext<this>) => void,
  ): this {
    throw new Error('Not implemented');
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

export const $automation = $constructor(Automation);

export type AutomationWithScope<TScope extends Scope> = Automation & {
  [types]: {
    scope: TScope;
  };
};

export type AutomationCallbackContext<TAutomation extends Automation> = {
  devices: DeviceDeclarationsToDeviceEndpoints<TAutomation[types]['devices']>;
  configs: ConfigDeclarationsToConfigs<TAutomation[types]['configs']>;
};
