import type {RemoteObjectInstance} from '@remote-object/core';

import type {DeviceQuery} from '../device-query.js';
import type {Scope} from '../scope.js';

import type {DeviceEndpoint} from './device-endpoint.js';
import type {
  DeviceConstructor,
  UnknownDevice,
  UnknownDeviceConstructor,
} from './device.js';

export type DeviceMultipleDeclaration<T extends UnknownDeviceConstructor> = {
  class: T;
  multiple: true;
};

export type DeviceDeclaration =
  | UnknownDeviceConstructor
  | readonly UnknownDeviceConstructor[]
  | DeviceMultipleDeclaration<UnknownDeviceConstructor>;

export type UnknownDeviceDeclarations = Record<string, DeviceDeclaration>;

export function $multiple<TConstructor extends UnknownDeviceConstructor>(
  deviceClass: TConstructor,
): DeviceMultipleDeclaration<TConstructor> {
  return {
    class: deviceClass,
    multiple: true,
  };
}

export type DeviceDeclarationToDeviceEndpoint<
  TDeclaration extends DeviceDeclaration,
> =
  TDeclaration extends DeviceConstructor<infer TDeviceEndpoint>
    ? TDeviceEndpoint
    : TDeclaration extends readonly UnknownDeviceConstructor[]
      ? {
          [TIndex in keyof TDeclaration]: TDeclaration[TIndex] extends DeviceConstructor<
            infer TDeviceEndpoint
          >
            ? TDeviceEndpoint
            : never;
        }
      : TDeclaration extends DeviceMultipleDeclaration<
            DeviceConstructor<infer TDeviceEndpoint>
          >
        ? TDeviceEndpoint[]
        : never;

export type DeviceDeclarationsToDeviceEndpoints<
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

export type DeviceEndpointToRemoteDevice<
  TDeviceEndpoint extends DeviceEndpoint,
> = RemoteObjectInstance<Omit<TDeviceEndpoint, keyof DeviceEndpoint>>;

export type DeviceDeclarationToRemoteDevice<
  TDeclaration extends DeviceDeclaration,
> =
  TDeclaration extends DeviceConstructor<infer TDeviceEndpoint>
    ? DeviceEndpointToRemoteDevice<TDeviceEndpoint>
    : TDeclaration extends readonly UnknownDeviceConstructor[]
      ? {
          [TIndex in keyof TDeclaration]: TDeclaration[TIndex] extends DeviceConstructor<
            infer TDeviceEndpoint
          >
            ? DeviceEndpointToRemoteDevice<TDeviceEndpoint>
            : never;
        }
      : TDeclaration extends DeviceMultipleDeclaration<
            DeviceConstructor<infer TDeviceEndpoint>
          >
        ? DeviceEndpointToRemoteDevice<TDeviceEndpoint>[]
        : never;

export type DeviceDeclarationToRemoteDevices<
  TDeclarations extends UnknownDeviceDeclarations,
> = {
  [TKey in keyof TDeclarations]: DeviceDeclarationToRemoteDevice<
    TDeclarations[TKey]
  >;
};
