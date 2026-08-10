import * as x from 'x-value';

import {DeviceEntry} from './device.js';
import {
  getDeviceConstructor,
  getProviderNamespaceDeviceConstructor,
  hasProviderNamespace,
} from './runtime/index.js';
import type {NamedObject, types} from './types.js';

export const ScopeName = x.string.nominal<'scope name'>();

export type ScopeName = x.TypeOf<typeof ScopeName>;

export const ScopePath = x.array(ScopeName);

export type ScopePath = x.TypeOf<typeof ScopePath>;

export class Scope implements NamedObject<ScopeName> {
  declare [types]: {name: ScopeName};

  private readonly scopeMap = new Map<string, ScopeWithDeviceConstructors>();

  private readonly deviceMap = new Map<string, DeviceEntry>();

  private readonly namespaceMap = new Map<string, object>();

  readonly name: ScopeName;

  constructor(
    name: string,
    readonly parent?: Scope,
  ) {
    this.name = name as ScopeName;
  }

  get path(): ScopePath {
    const {name, parent} = this;

    if (parent) {
      return [...parent.path, name];
    } else {
      return [name];
    }
  }

  get scopes(): IterableIterator<Scope> {
    return this.scopeMap.values();
  }

  get devices(): IterableIterator<DeviceEntry> {
    return this.deviceMap.values();
  }

  getOrCreateDeviceEntry(name: string): DeviceEntry {
    let deviceEntry = this.deviceMap.get(name);

    if (deviceEntry === undefined) {
      deviceEntry = new DeviceEntry(name);
      this.deviceMap.set(name, deviceEntry);
    }

    return deviceEntry;
  }

  getOrCreateNamespace(name: string, create: () => object): object {
    let namespace = this.namespaceMap.get(name);

    if (namespace === undefined) {
      namespace = create();
      this.namespaceMap.set(name, namespace);
    }

    return namespace;
  }

  $scope(name: string): ScopeWithDeviceConstructors {
    let scope = this.scopeMap.get(name);

    if (scope === undefined) {
      scope = createScopeWithDeviceConstructors(new Scope(name, this));
      this.scopeMap.set(name, scope);
    }

    return scope;
  }
}

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface DeviceConstructors {}

    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface ProviderNamespaces {}
  }
}

type ScopeWithDeviceConstructors = Scope &
  DeviceConstructors<Home.DeviceConstructors> & {
    [TNamespace in keyof Home.ProviderNamespaces]: DeviceConstructors<
      Home.ProviderNamespaces[TNamespace]
    >;
  };

type DeviceConstructors<TDeviceConstructors> = {
  [TKey in Extract<keyof TDeviceConstructors, string> as `$${TKey}`]: (
    name: string,
  ) => TDeviceConstructors[TKey];
} & {
  [TKey in Extract<keyof TDeviceConstructors, string> as `$$${TKey}`]: (
    name: string,
  ) => TDeviceConstructors[TKey][];
};

function createScopeWithDeviceConstructors(
  scope: Scope,
): ScopeWithDeviceConstructors;
function createScopeWithDeviceConstructors(scope: Scope): Scope {
  return new Proxy(scope, {
    get(target, property, receiver) {
      if (typeof property === 'string' && !Reflect.has(target, property)) {
        if (property.startsWith('$$')) {
          // TODO: Resolve direct multi-device constructors.
        } else if (property.startsWith('$')) {
          const deviceType = property.slice(1);

          return (name: string) => {
            const Constructor = getDeviceConstructor(deviceType);

            if (Constructor === undefined) {
              throw new TypeError(`Unknown device constructor: ${deviceType}.`);
            }

            return scope
              .getOrCreateDeviceEntry(name)
              .getOrCreateInstance(Constructor);
          };
        } else if (hasProviderNamespace(property)) {
          return scope.getOrCreateNamespace(property, () =>
            createProviderNamespaceWithDeviceConstructors(scope, property),
          );
        }
      }

      return Reflect.get(target, property, receiver);
    },
  });
}

function createProviderNamespaceWithDeviceConstructors(
  scope: Scope,
  providerNamespace: string,
): object {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === 'string') {
          if (property.startsWith('$$')) {
            // TODO: Resolve multi-device constructors.
          } else if (property.startsWith('$')) {
            const deviceType = property.slice(1);

            return (name: string) => {
              const Constructor = getProviderNamespaceDeviceConstructor(
                providerNamespace,
                deviceType,
              );

              if (Constructor === undefined) {
                throw new TypeError(
                  `Unknown device constructor: ${providerNamespace}.${deviceType}.`,
                );
              }

              return scope
                .getOrCreateDeviceEntry(name)
                .getOrCreateInstance(Constructor);
            };
          }
        }

        return undefined;
      },
    },
  );
}
