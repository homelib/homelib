import {assertDeclaring} from './@lifecycle.js';
import type {Device, DeviceConstructor} from './device.js';
import type {EndpointConnectionMetadata} from './endpoint.js';
import {Provider, type RuntimeProvider} from './provider.js';
import type {Scope} from './scope.js';

const PROVIDER_MAP = new Map<string, Map<string, RuntimeProvider>>();
const DEVICE_CONSTRUCTOR_MAP = new Map<string, DeviceConstructor<Device>>();
const PROVIDER_NAMESPACE_DEVICE_CONSTRUCTOR_MAP = new Map<
  string,
  Map<string, DeviceConstructor<Device>>
>();
const ROOT_SCOPE_SET = new Set<Scope>();

export function register<TMetadata extends EndpointConnectionMetadata>(
  providerNamespace: Extract<keyof Home.ProviderNamespaces, string>,
  provider: Provider<TMetadata>,
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
    | Record<string, DeviceConstructor<Device>>
    | Extract<keyof Home.ProviderNamespaces, string>,
  providerOrConstructors?:
    RuntimeProvider | Record<string, DeviceConstructor<Device>>,
): void {
  assertDeclaring();

  if (typeof objectOrProviderNamespace === 'string') {
    if (providerOrConstructors instanceof Provider) {
      registerProvider(objectOrProviderNamespace, providerOrConstructors);
    } else if (providerOrConstructors === undefined) {
      throw new TypeError('Expecting a provider or device constructors.');
    } else {
      PROVIDER_NAMESPACE_DEVICE_CONSTRUCTOR_MAP.set(
        objectOrProviderNamespace,
        new Map(Object.entries(providerOrConstructors)),
      );
    }
  } else {
    for (const [deviceType, Constructor] of Object.entries(
      objectOrProviderNamespace,
    )) {
      DEVICE_CONSTRUCTOR_MAP.set(deviceType, Constructor);
    }
  }
}

export function registerRootScope(scope: Scope): void {
  assertDeclaring();
  ROOT_SCOPE_SET.add(scope);
}

export function* getProviders(): IterableIterator<RuntimeProvider> {
  for (const providerNameMap of PROVIDER_MAP.values()) {
    yield* providerNameMap.values();
  }
}

export function getProvider(
  providerNamespace: string,
  providerName: string,
): RuntimeProvider | undefined {
  return PROVIDER_MAP.get(providerNamespace)?.get(providerName);
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

export function getRootScopes(): IterableIterator<Scope> {
  return ROOT_SCOPE_SET.values();
}

type DeviceConstructors<TDevices> = {
  [TKey in Extract<keyof TDevices, string>]: DeviceConstructor<
    TDevices[TKey] & Device
  >;
};

type ProviderNamespaceDeviceConstructors<TDevices> =
  DeviceConstructors<TDevices>;

function registerProvider(
  providerNamespace: string,
  provider: RuntimeProvider,
): void {
  let providerNameMap = PROVIDER_MAP.get(providerNamespace);

  if (providerNameMap === undefined) {
    providerNameMap = new Map();
    PROVIDER_MAP.set(providerNamespace, providerNameMap);
  }

  if (providerNameMap.has(provider.name)) {
    throw new TypeError(`Duplicate provider: ${provider.name}.`);
  }

  providerNameMap.set(provider.name, provider);
}
