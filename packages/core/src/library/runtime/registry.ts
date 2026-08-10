import type {Command} from '../command.js';
import type {Device, DeviceConstructor} from '../device.js';
import {Provider} from '../provider.js';

const PROVIDER_SET = new Set<Provider<Command>>();
const DEVICE_CONSTRUCTOR_MAP = new Map<string, DeviceConstructor<Device>>();
const PROVIDER_NAMESPACE_DEVICE_CONSTRUCTOR_MAP = new Map<
  string,
  Map<string, DeviceConstructor<Device>>
>();

export function register<TCommand extends Command>(
  object: Provider<TCommand>,
): void;
export function register(
  constructors: DeviceConstructors<Home.DeviceConstructors>,
): void;
export function register<
  TProviderNamespace extends Extract<keyof Home.ProviderNamespaces, string>,
>(
  providerNamespace: TProviderNamespace,
  constructors: ProviderNamespaceDeviceConstructors<
    Home.ProviderNamespaces[TProviderNamespace]
  >,
): void;
export function register(
  objectOrProviderNamespace:
    Provider<Command> | Record<string, DeviceConstructor<Device>> | string,
  constructors?: Record<string, DeviceConstructor<Device>>,
): void {
  if (typeof objectOrProviderNamespace === 'string') {
    if (constructors === undefined) {
      throw new TypeError('Expecting device constructors.');
    }

    PROVIDER_NAMESPACE_DEVICE_CONSTRUCTOR_MAP.set(
      objectOrProviderNamespace,
      new Map(Object.entries(constructors)),
    );
  } else if (objectOrProviderNamespace instanceof Provider) {
    PROVIDER_SET.add(objectOrProviderNamespace);
  } else {
    for (const [deviceType, Constructor] of Object.entries(
      objectOrProviderNamespace,
    )) {
      DEVICE_CONSTRUCTOR_MAP.set(deviceType, Constructor);
    }
  }
}

export function getDeviceConstructor(
  deviceType: string,
): DeviceConstructor<Device> | undefined {
  return DEVICE_CONSTRUCTOR_MAP.get(deviceType);
}

export function hasProviderNamespace(providerNamespace: string): boolean {
  return PROVIDER_NAMESPACE_DEVICE_CONSTRUCTOR_MAP.has(providerNamespace);
}

export function getProviderNamespaceDeviceConstructor(
  providerNamespace: string,
  deviceType: string,
): DeviceConstructor<Device> | undefined {
  return PROVIDER_NAMESPACE_DEVICE_CONSTRUCTOR_MAP.get(providerNamespace)?.get(
    deviceType,
  );
}

type DeviceConstructors<TDevices> = {
  [TKey in Extract<keyof TDevices, string>]: DeviceConstructor<
    TDevices[TKey] & Device
  >;
};

type ProviderNamespaceDeviceConstructors<TDevices> =
  DeviceConstructors<TDevices>;
