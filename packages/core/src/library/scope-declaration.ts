import type {Device, DeviceConstructor} from './device.js';
import {
  getDeviceConstructor,
  getProviderNamespaceDeviceConstructor,
  hasProviderNamespace,
} from './registry.js';
import {Scope} from './scope.js';
import type {NamedObject} from './types.js';

/** A device node in the immutable callback builder's type state. */
export type DeviceDeclarationNode<TDevice extends Device = Device> = {
  readonly kind: 'device';
  readonly device: TDevice;
};

export type NestedScopeDeclarationNode<
  TChildren extends ScopeDeclarationChildren = ScopeDeclarationChildren,
> = {
  readonly kind: 'scope';
  readonly children: TChildren;
};

export type ScopeDeclarationNode =
  DeviceDeclarationNode | NestedScopeDeclarationNode;

export type ScopeDeclarationChildren = {
  readonly [name: string]: ScopeDeclarationNode;
};

declare const SCOPE_DECLARATION_BUILDER_STATE: unique symbol;
declare const SCOPE_DECLARATION_OWNER_VARIANCE: unique symbol;

export type ScopeDeclarationBuilder<
  TChildren extends ScopeDeclarationChildren,
  TOwner = unknown,
> = ScopeDeclarationBuilderMethods<TChildren, TOwner> &
  DeviceDeclarationMethods<Home.DeviceConstructors, TChildren, TOwner> & {
    readonly [
      TNamespace in Extract<keyof Home.ProviderNamespaces, string>
    ]: DeviceDeclarationMethods<
      Home.ProviderNamespaces[TNamespace],
      TChildren,
      TOwner
    >;
  } & {
    readonly [SCOPE_DECLARATION_BUILDER_STATE]: {
      readonly children: TChildren;
      readonly owner: TOwner;
    };
  };

export type ScopeDeclarationBuilderChildren<TBuilder> =
  TBuilder extends ScopeDeclarationBuilder<infer TChildren, infer _TOwner>
    ? TChildren
    : never;

export type MaterializedScopeDeclaration<
  TChildren extends ScopeDeclarationChildren,
> = string extends keyof TChildren
  ? {}
  : {
      readonly [TName in keyof TChildren]: MaterializedDeclarationNode<
        Extract<TName, string>,
        TChildren[TName]
      >;
    };

type ScopeDeclarationBuilderMethods<
  TChildren extends ScopeDeclarationChildren,
  TOwner,
> = {
  $scope<
    const TName extends string,
    TChildChildren extends ScopeDeclarationChildren,
  >(
    name: TName & ValidScopeTreeChildName<TName, TChildren>,
    declare: <TInvocation>(
      scope: ScopeDeclarationBuilder<
        {},
        NestedScopeDeclarationOwner<TOwner, TName, TInvocation>
      >,
    ) => ScopeDeclarationBuilder<
      TChildChildren,
      NestedScopeDeclarationOwner<TOwner, TName, TInvocation>
    >,
  ): ScopeDeclarationBuilder<
    AddScopeDeclarationChild<
      TChildren,
      TName,
      NestedScopeDeclarationNode<TChildChildren>
    >,
    TOwner
  >;
};

type DeviceDeclarationMethods<
  TDevices,
  TChildren extends ScopeDeclarationChildren,
  TOwner,
> = {
  [TDeviceType in Extract<keyof TDevices, string> as `$${TDeviceType}`]: <
    const TName extends string,
  >(
    name: TName & ValidScopeTreeChildName<TName, TChildren>,
  ) => ScopeDeclarationBuilder<
    AddScopeDeclarationChild<
      TChildren,
      TName,
      DeviceDeclarationNode<Extract<TDevices[TDeviceType], Device>>
    >,
    TOwner
  >;
};

type NestedScopeDeclarationOwner<TOwner, TName extends string, TInvocation> = {
  readonly parent: TOwner;
  readonly name: TName;
  readonly [SCOPE_DECLARATION_OWNER_VARIANCE]: (
    value: TInvocation,
  ) => TInvocation;
};

type MaterializedDeclarationNode<
  TName extends string,
  TNode extends ScopeDeclarationNode,
> =
  TNode extends DeviceDeclarationNode<infer TDevice>
    ? TDevice
    : TNode extends NestedScopeDeclarationNode<infer TChildren>
      ? Scope & NamedObject<TName> & MaterializedScopeDeclaration<TChildren>
      : never;

type AddScopeDeclarationChild<
  TChildren extends ScopeDeclarationChildren,
  TName extends string,
  TNode extends ScopeDeclarationNode,
> = TChildren & Readonly<Record<TName, TNode>>;

type ValidScopeTreeChildName<
  TName extends string,
  TChildren extends ScopeDeclarationChildren,
> =
  IsSingleConcreteString<TName> extends true
    ? TName extends
        ScopeTreeReservedChildName | Extract<keyof TChildren, string>
      ? never
      : unknown
    : never;

type IsSingleConcreteString<T extends string> = string extends T
  ? false
  : IsUnion<T> extends true
    ? false
    : // Infinite template-literal patterns have no statically required key.
      {} extends Record<T, never>
      ? false
      : true;

type IsUnion<T, TWhole = T> = T extends unknown
  ? [TWhole] extends [T]
    ? false
    : true
  : never;

const ADDITIONAL_RESERVED_SCOPE_TREE_CHILD_NAMES = [
  'name',
  'parent',
  'scopeMap',
  'deviceMap',
  'namespaceMap',
  'constructor',
  '__defineGetter__',
  '__defineSetter__',
  'hasOwnProperty',
  '__lookupGetter__',
  '__lookupSetter__',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
  'prototype',
  '__proto__',
  'then',
  'toJSON',
  '__types__',
] as const;

type ScopeTreeReservedChildName =
  | Extract<keyof Scope, string>
  | Extract<keyof Home.ProviderNamespaces, string>
  | `$${string}`
  | (typeof ADDITIONAL_RESERVED_SCOPE_TREE_CHILD_NAMES)[number];

type RuntimeDeviceDeclarationNode = {
  readonly kind: 'device';
  readonly Constructor: DeviceConstructor<Device>;
};

type RuntimeNestedScopeDeclarationNode = {
  readonly kind: 'scope';
  readonly children: ReadonlyMap<string, RuntimeScopeDeclarationNode>;
};

type RuntimeScopeDeclarationNode =
  RuntimeDeviceDeclarationNode | RuntimeNestedScopeDeclarationNode;

/** @internal */
export type RuntimeScopeDeclaration = {
  readonly children: ReadonlyMap<string, RuntimeScopeDeclarationNode>;
};

type DeclarationBuilderState = {
  readonly token: object;
  readonly children: ReadonlyMap<string, RuntimeScopeDeclarationNode>;
};

const BUILDER_STATE_MAP = new WeakMap<object, DeclarationBuilderState>();

const RESERVED_SCOPE_TREE_CHILD_NAMES = new Set<string>(
  ADDITIONAL_RESERVED_SCOPE_TREE_CHILD_NAMES,
);

/** @internal */
export function createScopeDeclaration<
  TOwner,
  TBuilder extends ScopeDeclarationBuilder<ScopeDeclarationChildren, TOwner>,
>(
  declare: (scope: ScopeDeclarationBuilder<{}, TOwner>) => TBuilder,
): RuntimeScopeDeclaration {
  const token = {};
  const builder = createDeclarationBuilder(
    token,
    new Map(),
  ) as ScopeDeclarationBuilder<{}, TOwner>;
  const declaredBuilder = declare(builder);
  const state = getReturnedBuilderState(declaredBuilder, token);

  return {children: state.children};
}

/** @internal */
export function materializeScopeDeclaration(
  scope: Scope,
  declaration: RuntimeScopeDeclaration,
): void {
  const directChildren = new Map<string, Scope | Device>();

  for (const [name, node] of declaration.children) {
    if (node.kind === 'scope') {
      const childScope = scope.$scope(name);
      materializeScopeDeclaration(childScope, node);
      directChildren.set(name, childScope);
    } else {
      const device = scope
        .createDeviceEntry(name)
        .createInstance(node.Constructor);
      directChildren.set(name, device);
    }
  }

  for (const [name, child] of directChildren) {
    Object.defineProperty(scope, name, {
      configurable: false,
      enumerable: true,
      value: child,
      writable: false,
    });
  }
}

function createDeclarationBuilder(
  token: object,
  children: ReadonlyMap<string, RuntimeScopeDeclarationNode>,
): ScopeDeclarationBuilder<{}, unknown> {
  const target = Object.create(null) as object;
  const builder = new Proxy(target, {
    get(_target, property) {
      if (property === '$scope') {
        return (
          name: string,
          declare: (scope: ScopeDeclarationBuilder<{}, unknown>) => unknown,
        ) => {
          assertScopeTreeChildName(name, children);

          if (typeof declare !== 'function') {
            throw new TypeError('Expecting a scope declaration callback.');
          }

          const childToken = {};
          const childBuilder = createDeclarationBuilder(childToken, new Map());
          const declaredChildBuilder = declare(childBuilder);
          const childState = getReturnedBuilderState(
            declaredChildBuilder,
            childToken,
          );

          return addDeclarationNode(token, children, name, {
            kind: 'scope',
            children: childState.children,
          });
        };
      }

      if (typeof property === 'string') {
        if (property.startsWith('$')) {
          const deviceType = property.slice(1);

          return (name: string) => {
            const Constructor = getDeviceConstructor(deviceType);

            if (Constructor === undefined) {
              throw new TypeError(`Unknown device constructor: ${deviceType}.`);
            }

            assertScopeTreeChildName(name, children);

            return addDeclarationNode(token, children, name, {
              kind: 'device',
              Constructor,
            });
          };
        }

        if (hasProviderNamespace(property)) {
          return createProviderNamespaceDeclarationBuilder(
            token,
            children,
            property,
          );
        }
      }

      return undefined;
    },
  });

  BUILDER_STATE_MAP.set(builder, {token, children});

  return builder as ScopeDeclarationBuilder<{}, unknown>;
}

function createProviderNamespaceDeclarationBuilder(
  token: object,
  children: ReadonlyMap<string, RuntimeScopeDeclarationNode>,
  providerNamespace: string,
): object {
  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (typeof property === 'string' && property.startsWith('$')) {
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

          assertScopeTreeChildName(name, children);

          return addDeclarationNode(token, children, name, {
            kind: 'device',
            Constructor,
          });
        };
      }

      return undefined;
    },
  });
}

function addDeclarationNode(
  token: object,
  children: ReadonlyMap<string, RuntimeScopeDeclarationNode>,
  name: string,
  node: RuntimeScopeDeclarationNode,
): ScopeDeclarationBuilder<{}> {
  return createDeclarationBuilder(token, new Map([...children, [name, node]]));
}

function getReturnedBuilderState(
  builder: unknown,
  token: object,
): DeclarationBuilderState {
  if (isPromiseLike(builder)) {
    throw new TypeError('Scope declaration callbacks must be synchronous.');
  }

  if (
    (typeof builder !== 'object' && typeof builder !== 'function') ||
    builder === null
  ) {
    throw new TypeError('Scope declaration callbacks must return a builder.');
  }

  const state = BUILDER_STATE_MAP.get(builder);

  if (state === undefined || state.token !== token) {
    throw new TypeError(
      'Scope declaration callbacks must return their own builder.',
    );
  }

  return state;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof Reflect.get(value, 'then') === 'function'
  );
}

function assertScopeTreeChildName(
  name: unknown,
  children: ReadonlyMap<string, RuntimeScopeDeclarationNode>,
): asserts name is string {
  if (typeof name !== 'string') {
    throw new TypeError('Scope tree child names must be strings.');
  }

  if (
    name.startsWith('$') ||
    RESERVED_SCOPE_TREE_CHILD_NAMES.has(name) ||
    name in Scope.prototype ||
    hasProviderNamespace(name)
  ) {
    throw new TypeError(`Reserved scope tree child name: ${name}.`);
  }

  if (children.has(name)) {
    throw new TypeError(`Duplicate scope tree child: ${name}.`);
  }
}
