import type {AutomationWithScope} from '../automation.js';
import type {UnknownDevice} from '../device/index.js';
import type {Plugin} from '../plugin.js';
import type {NamedTupleToRecord, UnknownNamedObject} from '../types.js';
import {types} from '../types.js';
import {$constructor} from '../utils/index.js';

export class Scope implements UnknownNamedObject {
  declare [types]: {
    name: string;
    scopes: {};
    devices: {};
  };

  readonly name: this[types]['name'];

  _parent: Scope | undefined;

  private scopeMap = new Map<string, Scope>();

  private deviceMap = new Map<string, UnknownDevice>();

  constructor(
    name: string,
    readonly root = false,
  ) {
    this.name = name;
  }

  get _path(): string[] {
    const {name, root, _parent: parent} = this;

    if (root) {
      return [];
    }

    if (!parent) {
      throw new Error('Expecting non-root scope to have parent.');
    }

    return [...parent._path, name];
  }

  scopes<const TScopes extends readonly Scope[]>(
    scopes: TScopes,
  ): this & {
    [types]: {
      scopes: NamedTupleToRecord<TScopes>;
    };
  };
  scopes(scopes: Scope[]): this {
    const {scopeMap} = this;

    for (const scope of scopes) {
      const {name, root, _parent: parent} = scope;

      if (root) {
        throw new Error(
          `Cannot add root scope ${JSON.stringify(name)} to another scope.`,
        );
      }

      if (parent) {
        throw new Error(
          `Scope already added to parent scope ${JSON.stringify(parent.name)}.`,
        );
      }

      scope._parent = this;

      if (scopeMap.has(name)) {
        throw new Error(
          `Scope with name ${JSON.stringify(name)} already exists.`,
        );
      }

      scopeMap.set(name, scope);
    }

    return this;
  }

  plugins(plugins: Plugin[]): this {
    return this;
  }

  devices<const TDevices extends readonly UnknownDevice[]>(
    devices: TDevices,
  ): this & {
    [types]: {
      devices: NamedTupleToRecord<TDevices>;
    };
  };
  devices(devices: UnknownDevice[]): this {
    const {deviceMap} = this;

    for (const device of devices) {
      const {name, _scope: scope} = device;

      if (scope) {
        throw new Error(
          `Device already added to scope ${JSON.stringify(scope.name)}`,
        );
      }

      device._scope = this;

      if (deviceMap.has(name)) {
        throw new Error(
          `Device with name ${JSON.stringify(name)} already exists.`,
        );
      }

      deviceMap.set(name, device);
    }

    return this;
  }

  automations(automations: AutomationWithScope<this>[]): this {
    return this;
  }

  _getDevice(
    scopePath: string[],
    deviceName: string,
  ): UnknownDevice | undefined {
    const {deviceMap, scopeMap} = this;

    if (scopePath.length === 0) {
      return deviceMap.get(deviceName);
    }

    const [scopeName, ...restScopePath] = scopePath;

    const scope = scopeMap.get(scopeName);

    if (!scope) {
      return undefined;
    }

    return scope._getDevice(restScopePath, deviceName);
  }

  *_iterateAllDevices(): IterableIterator<UnknownDevice> {
    for (const [, device] of this.deviceMap) {
      yield device;
    }

    for (const [, scope] of this.scopeMap) {
      yield* scope._iterateAllDevices();
    }
  }
}

export const $scope = $constructor(Scope);
