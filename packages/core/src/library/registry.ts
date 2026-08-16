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
const ROOT_SCOPE_MAP = new Map<string, Scope>();

export function register<TMetadata extends EndpointConnectionMetadata>(
  providerNamespace: Extract<keyof Home.ProviderNamespaces, string>,
  provider: Provider<TMetadata>,
): void;
export function register<
  const TConstructors extends Record<string, DeviceConstructor<Device>>,
>(
  constructors: TConstructors &
    RegisteredDeviceConstructors<TConstructors, Home.DeviceConstructors>,
): void;
export function register<
  TProviderNamespace extends Extract<keyof Home.ProviderNamespaces, string>,
>(
  providerNamespace: TProviderNamespace,
  constructors: DeviceConstructors<Home.ProviderNamespaces[TProviderNamespace]>,
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

  if (ROOT_SCOPE_MAP.has(scope.name)) {
    throw new TypeError(`Duplicate home: ${scope.name}.`);
  }

  ROOT_SCOPE_MAP.set(scope.name, scope);
}

export function* getProviderEntries(): IterableIterator<
  readonly [namespace: string, provider: RuntimeProvider]
> {
  for (const [namespace, providerNameMap] of PROVIDER_MAP) {
    for (const provider of providerNameMap.values()) {
      yield [namespace, provider];
    }
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
  return ROOT_SCOPE_MAP.values();
}

type DeviceConstructors<TDevices> = {
  [TKey in Extract<keyof TDevices, string>]: DeviceConstructor<
    TDevices[TKey] & Device
  >;
};

type RegisteredDeviceConstructors<TConstructors, TDevices> = {
  [TKey in keyof TConstructors]: TKey extends keyof TDevices
    ? DeviceConstructor<Extract<TDevices[TKey], Device>>
    : never;
};

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
