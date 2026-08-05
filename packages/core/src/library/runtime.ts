import type {Command} from './command.js';
import {Device} from './device.js';
import type {Provider} from './provider.js';

const DEVICE_SET = new Set<Device>();
const PROVIDER_SET = new Set<Provider<Command>>();
const PROVIDER_NAMESPACE_DEVICE_CONSTRUCTOR_MAP = new Map<
  string,
  Map<string, abstract new (...args: never[]) => Device>
>();

type ProviderNamespaceDeviceConstructors<TDevices> = {
  [TKey in Extract<keyof TDevices, string>]: abstract new (
    ...args: never[]
  ) => TDevices[TKey] & Device;
};

export function register(object: Device): void;
export function register<TCommand extends Command>(
  object: Provider<TCommand>,
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
  objectOrProviderNamespace: Device | Provider<Command> | string,
  constructors?: Record<string, abstract new (...args: never[]) => Device>,
): void {
  if (typeof objectOrProviderNamespace === 'string') {
    if (constructors === undefined) {
      throw new TypeError('Expecting device constructors.');
    }

    PROVIDER_NAMESPACE_DEVICE_CONSTRUCTOR_MAP.set(
      objectOrProviderNamespace,
      new Map(Object.entries(constructors)),
    );
  } else if (objectOrProviderNamespace instanceof Device) {
    DEVICE_SET.add(objectOrProviderNamespace);
  } else {
    PROVIDER_SET.add(objectOrProviderNamespace);
  }
}
