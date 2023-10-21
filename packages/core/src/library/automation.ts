import type {
  ConfigDeclaration,
  UnknownConfigDeclarations,
  ConfigDeclarationsToConfigs,
} from './config.js';
import type {
  Device,
  UnknownDeviceConstructor,
  UnknownDevice,
  DeviceConstructor,
} from './device/index.js';
import type {DeviceQuery} from './device-query.js';
import type {Scope} from './scopes/index.js';
import {types} from './types.js';
import {$constructor} from './utils/index.js';

export class Automation {
  declare [types]: {
    scope: Scope;
    devices: {};
    configs: {};
  };

  constructor(readonly name: string) {}

  devices<
    const TDeviceDeclarations extends Automation.UnknownDeviceDeclarations,
  >(
    devices: TDeviceDeclarations,
  ): this & {
    [types]: {
      devices: TDeviceDeclarations;
    };
  };
  devices(devices: Automation.UnknownDeviceDeclarations): this {
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

  start(
    callback: (
      devices: Automation.DeviceDeclarationsToDevices<this[types]['devices']>,
      configs: ConfigDeclarationsToConfigs<this[types]['configs']>,
    ) => void,
  ): this {
    throw new Error('Not implemented');
  }

  react(
    callback: (
      devices: Automation.DeviceDeclarationsToDevices<this[types]['devices']>,
      configs: ConfigDeclarationsToConfigs<this[types]['configs']>,
    ) => void,
  ): this {
    throw new Error('Not implemented');
  }

  bind<TScope extends Scope>(
    devices: Automation.DeviceDeclarationsToDeviceBindings<
      this[types]['devices'],
      TScope
    >,
  ): this & {
    [types]: {
      scope: TScope;
    };
  } {
    throw new Error('Not implemented');
  }
}

export type AutomationWithScope<TScope extends Scope> = Automation & {
  [types]: {
    scope: TScope;
  };
};

export namespace Automation {
  export type DeviceDeclaration =
    | UnknownDeviceConstructor
    | readonly UnknownDeviceConstructor[]
    | {
        class: UnknownDeviceConstructor;
        multiple: true;
      };

  export type UnknownDeviceDeclarations = Record<string, DeviceDeclaration>;

  export type DeviceDeclarationToDeviceEndpoint<
    TDeclaration extends DeviceDeclaration,
  > = TDeclaration extends DeviceConstructor<infer TDeviceEndpoint>
    ? TDeviceEndpoint
    : TDeclaration extends readonly UnknownDeviceConstructor[]
    ? {
        [TIndex in keyof TDeclaration]: TDeclaration[TIndex] extends DeviceConstructor<
          infer TDeviceEndpoint
        >
          ? TDeviceEndpoint
          : never;
      }
    : TDeclaration extends {
        class: DeviceConstructor<infer TDeviceEndpoint>;
        multiple: true;
      }
    ? TDeviceEndpoint[]
    : never;

  export type DeviceDeclarationsToDevices<
    TDeclarations extends Automation.UnknownDeviceDeclarations,
  > = {
    [TKey in keyof TDeclarations]: DeviceDeclarationToDeviceEndpoint<
      TDeclarations[TKey]
    >;
  };

  export type DeviceToDeviceBinding<
    TScope extends Scope,
    TDevice extends UnknownDevice,
  > = TDevice | DeviceQuery<TScope, TDevice>;

  export type DeviceDeclarationToDeviceBinding<
    TDeclaration extends DeviceDeclaration,
    TScope extends Scope,
  > = TDeclaration extends UnknownDeviceConstructor
    ? DeviceToDeviceBinding<TScope, InstanceType<TDeclaration>>
    : TDeclaration extends readonly UnknownDeviceConstructor[]
    ? {
        [TIndex in keyof TDeclaration]: DeviceToDeviceBinding<
          TScope,
          InstanceType<
            Extract<TDeclaration[TIndex], new (...args: never[]) => object>
          >
        >;
      }
    : TDeclaration extends {
        class: infer TDeviceConstructor extends UnknownDeviceConstructor;
        multiple: true;
      }
    ? DeviceToDeviceBinding<
        TScope,
        InstanceType<TDeviceConstructor>
      > extends infer TBinding
      ? TBinding | TBinding[]
      : never
    : never;

  export type DeviceDeclarationsToDeviceBindings<
    TDeclarations extends Automation.UnknownDeviceDeclarations,
    TScope extends Scope,
  > = {
    [TKey in keyof TDeclarations]: DeviceDeclarationToDeviceBinding<
      TDeclarations[TKey],
      TScope
    >;
  };
}

export const $automation = $constructor(Automation);
