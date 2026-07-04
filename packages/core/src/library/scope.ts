import * as x from 'x-value';

import type {NamedObject, types} from './types.js';

export const ScopeName = x.string.nominal<'scope name'>();

export type ScopeName = x.TypeOf<typeof ScopeName>;

export const ScopePath = x.array(ScopeName);

export type ScopePath = x.TypeOf<typeof ScopePath>;

export class Scope implements NamedObject<string> {
  declare [types]: {name: string};

  readonly name: ScopeName;

  constructor(
    name: string,
    /** @internal */
    readonly _parent?: Scope,
  ) {
    this.name = name as ScopeName;
  }

  get _path(): ScopePath {
    const {name, _parent: parent} = this;

    if (!parent) {
      throw new Error('Expecting non-root scope to have parent.');
    }

    return [...parent._path, name];
  }

  $scope(name: string): ScopeWithDeviceConstructors {
    return createScopeWithDeviceConstructors(new Scope(name, this));
  }
}

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface DeviceConstructors {}
  }
}

type ScopeWithDeviceConstructors = Scope & {
  [TKey in keyof Home.DeviceConstructors as `$${TKey}`]: (
    name: string,
  ) => Home.DeviceConstructors[TKey];
} & {
  [TKey in keyof Home.DeviceConstructors as `$$${TKey}`]: (
    name: string,
  ) => Home.DeviceConstructors[TKey][];
};

function createScopeWithDeviceConstructors(
  scope: Scope,
): ScopeWithDeviceConstructors;
function createScopeWithDeviceConstructors(scope: Scope): Scope {
  return scope;
}
