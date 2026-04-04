import type {DeviceQuery} from '../device-query.js';
import type {Scope} from '../scope.js';

import type {Device, DeviceConstructor} from './device.js';

export type DeviceMultipleDeclaration<T extends DeviceConstructor> = {
  class: T;
  multiple: true;
};

export type DeviceDeclaration =
  | DeviceConstructor
  | readonly DeviceConstructor[]
  | DeviceMultipleDeclaration<DeviceConstructor>;

export type UnknownDeviceDeclarations = Record<string, DeviceDeclaration>;

export function $multiple<TConstructor extends DeviceConstructor>(
  deviceClass: TConstructor,
): DeviceMultipleDeclaration<TConstructor> {
  return {
    class: deviceClass,
    multiple: true,
  };
}

export type DeviceDeclarationToDevice<TDeclaration extends DeviceDeclaration> =
  TDeclaration extends DeviceConstructor
    ? InstanceType<TDeclaration>
    : TDeclaration extends readonly DeviceConstructor[]
    ? {
        [TIndex in keyof TDeclaration]: TDeclaration[TIndex] extends DeviceConstructor
          ? InstanceType<TDeclaration[TIndex]>
          : never;
      }
    : TDeclaration extends DeviceMultipleDeclaration<infer TDeviceConstructor>
    ? InstanceType<TDeviceConstructor>[]
    : never;

export type DeviceDeclarationsToDeviceEndpoints<
  TDeclarations extends UnknownDeviceDeclarations,
> = {
  [TKey in keyof TDeclarations]: DeviceDeclarationToDevice<TDeclarations[TKey]>;
};

export type DeviceToDeviceBinding<
  TScope extends Scope,
  TDevice extends Device,
> = TDevice | DeviceQuery<TScope, TDevice>;

export type DeviceDeclarationToDeviceBinding<
  TDeclaration extends DeviceDeclaration,
  TScope extends Scope,
> = TDeclaration extends DeviceConstructor
  ? DeviceToDeviceBinding<TScope, InstanceType<TDeclaration>>
  : TDeclaration extends readonly DeviceConstructor[]
  ? {
      [TIndex in keyof TDeclaration]: DeviceToDeviceBinding<
        TScope,
        InstanceType<
          Extract<TDeclaration[TIndex], new (...args: never[]) => object>
        >
      >;
    }
  : TDeclaration extends DeviceMultipleDeclaration<infer TDeviceConstructor>
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
