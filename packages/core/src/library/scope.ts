import type {NamedObject, NamedTupleToRecord} from '@homelib/x';
import {types} from '@homelib/x';

import type {Automation, AutomationWithScope} from './automation.js';
import type {UnknownDevice} from './device/index.js';
import type {Plugin} from './plugin.js';
import type {
  AutomationName,
  DeviceName,
  ScopeName,
  ScopePath,
} from './x/index.js';

export abstract class Scope implements NamedObject<string> {
  declare [types]: {
    name: string;
    scopes: {};
    devices: {};
  };

  readonly name: ScopeName;

  _parent: Scope | undefined;

  private scopeMap = new Map<ScopeName, Scope>();

  private deviceMap = new Map<DeviceName, UnknownDevice>();

  private automationMap = new Map<AutomationName, Automation>();

  constructor(
    name: string,
    readonly root = false,
  ) {
    this.name = name as ScopeName;
  }

  get _path(): ScopePath {
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
    const {automationMap} = this;

    for (const automation of automations) {
      const {name} = automation;

      if (automationMap.has(name)) {
        throw new Error(
          `Automation with name ${JSON.stringify(name)} already exists.`,
        );
      }

      automationMap.set(name, automation);
    }

    return this;
  }

  _up(): void {
    for (const scope of this.scopeMap.values()) {
      scope._up();
    }
  }

  _getDevice(
    scopePath: ScopePath,
    deviceName: DeviceName,
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

  _queryDevices(queries: string[]): UnknownDevice[] {
    type QueryNode = Scope | UnknownDevice;

    const collectDevices = (scope: Scope): UnknownDevice[] => [
      ...scope.deviceMap.values(),
      ...[...scope.scopeMap.values()].flatMap(collectDevices),
    ];

    const collectMatchedNodes = (scope: Scope, query: string): QueryNode[] => {
      const matchedNodes: QueryNode[] = [];

      const matchedScope = scope.scopeMap.get(query as ScopeName);

      if (matchedScope) {
        matchedNodes.push(matchedScope);
      }

      const matchedDevice = scope.deviceMap.get(query as DeviceName);

      if (matchedDevice) {
        matchedNodes.push(matchedDevice);
      }

      for (const childScope of scope.scopeMap.values()) {
        matchedNodes.push(...collectMatchedNodes(childScope, query));
      }

      return matchedNodes;
    };

    const collectDevicesFromNode = (node: QueryNode): UnknownDevice[] =>
      node instanceof Scope ? collectDevices(node) : [node];

    let nodes: QueryNode[] = [this];

    for (const query of queries) {
      nodes = nodes.flatMap(node =>
        node instanceof Scope ? collectMatchedNodes(node, query) : [],
      );
    }

    const devices =
      queries.length === 0
        ? collectDevices(this)
        : nodes.flatMap(collectDevicesFromNode);

    return [...new Set(devices)];
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
