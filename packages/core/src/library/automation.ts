import type {
  ConfigDeclaration,
  ConfigDeclarationsConstraint,
  ConfigDeclarationsToConfigs,
} from './config.js';
import type {DeviceQuery} from './device-query.js';
import type {Device, DeviceConstructor} from './device.js';
import {types} from './types.js';
import {$constructor} from './utils/index.js';

export class Automation {
  declare [types]: {
    devices: {};
    configs: {};
  };

  devices<
    const TDeviceDeclarations extends Automation.DeviceDeclarationsConstraint,
  >(
    devices: TDeviceDeclarations,
  ): this & {
    [types]: {
      devices: TDeviceDeclarations;
    };
  };
  devices(devices: Automation.DeviceDeclarationsConstraint): this {
    return this;
  }

  configs<const TConfigDeclarations extends ConfigDeclarationsConstraint>(
    configs: TConfigDeclarations,
  ): this & {
    [types]: {
      configs: TConfigDeclarations;
    };
  };
  configs(configs: ConfigDeclarationsConstraint): this {
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

  bind(
    devices: Automation.DeviceDeclarationsToDeviceBindings<
      this[types]['devices']
    >,
  ): this {
    throw new Error('Not implemented');
  }
}

export namespace Automation {
  export type DeviceDeclaration =
    | DeviceConstructor
    | readonly DeviceConstructor[]
    | {
        class: DeviceConstructor;
        multiple: true;
      };

  export type DeviceDeclarationsConstraint = Record<string, DeviceDeclaration>;

  export type DeviceDeclarationToDevice<
    TDeclaration extends DeviceDeclaration,
  > = TDeclaration extends DeviceConstructor
    ? InstanceType<TDeclaration>
    : TDeclaration extends readonly DeviceConstructor[]
    ? {
        [TIndex in keyof TDeclaration]: InstanceType<
          Extract<TDeclaration[TIndex], new (...args: never[]) => object>
        >;
      }
    : TDeclaration extends {
        class: infer TDeviceConstructor extends DeviceConstructor;
        multiple: true;
      }
    ? InstanceType<TDeviceConstructor>[]
    : never;

  export type DeviceDeclarationsToDevices<
    TDeclarations extends Automation.DeviceDeclarationsConstraint,
  > = {
    [TKey in keyof TDeclarations]: DeviceDeclarationToDevice<
      TDeclarations[TKey]
    >;
  };

  export type DeviceToDeviceBinding<TDevice extends Device> =
    | TDevice
    | DeviceQuery;

  export type DeviceDeclarationToDeviceBinding<
    TDeclaration extends DeviceDeclaration,
  > = TDeclaration extends DeviceConstructor
    ? DeviceToDeviceBinding<InstanceType<TDeclaration>>
    : TDeclaration extends readonly DeviceConstructor[]
    ? {
        [TIndex in keyof TDeclaration]: DeviceToDeviceBinding<
          InstanceType<
            Extract<TDeclaration[TIndex], new (...args: never[]) => object>
          >
        >;
      }
    : TDeclaration extends {
        class: infer TDeviceConstructor extends DeviceConstructor;
        multiple: true;
      }
    ? DeviceToDeviceBinding<InstanceType<TDeviceConstructor>>[]
    : never;

  export type DeviceDeclarationsToDeviceBindings<
    TDeclarations extends Automation.DeviceDeclarationsConstraint,
  > = {
    [TKey in keyof TDeclarations]: DeviceDeclarationToDeviceBinding<
      TDeclarations[TKey]
    >;
  };
}

export const $automation = $constructor(Automation);
