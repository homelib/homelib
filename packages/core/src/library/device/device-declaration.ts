import type {DeviceQuery} from '../device-query.js';
import type {Scope} from '../scope.js';

import type {
  DeviceConstructor,
  UnknownDevice,
  UnknownDeviceConstructor,
} from './device.js';

export type DeviceDeclaration =
  | UnknownDeviceConstructor
  | readonly UnknownDeviceConstructor[]
  | {
      class: UnknownDeviceConstructor;
      multiple: true;
    };

export type UnknownDeviceDeclarations = Record<string, DeviceDeclaration>;

export function $multiple<TConstructor extends UnknownDeviceConstructor>(
  deviceClass: TConstructor,
): {
  class: TConstructor;
  multiple: true;
} {
  return {
    class: deviceClass,
    multiple: true,
  };
}

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
  TDeclarations extends UnknownDeviceDeclarations,
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
  TDeclarations extends UnknownDeviceDeclarations,
  TScope extends Scope,
> = {
  [TKey in keyof TDeclarations]: DeviceDeclarationToDeviceBinding<
    TDeclarations[TKey],
    TScope
  >;
};
