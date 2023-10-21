import type {Device, UnknownDevice} from './device/index.js';
import type {Scope} from './scopes/index.js';
import type {types} from './types.js';

export type DeviceQuery<TScope extends Scope, TDevice extends UnknownDevice> = {
  [types]: {
    scope: TScope;
    device: TDevice;
  };
};

export type UnknownDeviceQuery = DeviceQuery<Scope, UnknownDevice>;

export function $<
  TScope extends Scope,
  TDevice extends UnknownDevice,
  const TQ1 extends NextQueryForDevice<TScope, TDevice, []>,
>(q1: TQ1): DeviceQuery<TScope, TDevice>;
export function $<
  TScope extends Scope,
  TDevice extends UnknownDevice,
  const TQ1 extends NextQueryForDevice<TScope, TDevice, []>,
  const TQ2 extends NextQueryForDevice<TScope, TDevice, [TQ1]>,
>(q1: TQ1, q2: TQ2): DeviceQuery<TScope, TDevice>;
export function $<
  TScope extends Scope,
  TDevice extends UnknownDevice,
  const TQ1 extends NextQueryForDevice<TScope, TDevice, []>,
  const TQ2 extends NextQueryForDevice<TScope, TDevice, [TQ1]>,
  const TQ3 extends NextQueryForDevice<TScope, TDevice, [TQ1, TQ2]>,
>(q1: TQ1, q2: TQ2, q3: TQ3): DeviceQuery<TScope, TDevice>;
export function $<
  TScope extends Scope,
  TDevice extends UnknownDevice,
  const TQ1 extends NextQueryForDevice<TScope, TDevice, []>,
  const TQ2 extends NextQueryForDevice<TScope, TDevice, [TQ1]>,
  const TQ3 extends NextQueryForDevice<TScope, TDevice, [TQ1, TQ2]>,
  const TQ4 extends NextQueryForDevice<TScope, TDevice, [TQ1, TQ2, TQ3]>,
>(q1: TQ1, q2: TQ2, q3: TQ3, q4: TQ4): DeviceQuery<TScope, TDevice>;
export function $<
  TScope extends Scope,
  TDevice extends UnknownDevice,
  const TQ1 extends NextQueryForDevice<TScope, TDevice, []>,
  const TQ2 extends NextQueryForDevice<TScope, TDevice, [TQ1]>,
  const TQ3 extends NextQueryForDevice<TScope, TDevice, [TQ1, TQ2]>,
  const TQ4 extends NextQueryForDevice<TScope, TDevice, [TQ1, TQ2, TQ3]>,
  const TQ5 extends NextQueryForDevice<TScope, TDevice, [TQ1, TQ2, TQ3, TQ4]>,
>(q1: TQ1, q2: TQ2, q3: TQ3, q4: TQ4, q5: TQ5): DeviceQuery<TScope, TDevice>;
export function $<TDevice extends UnknownDevice, TScope extends Scope>(
  ...args: ScopeTreeForDevice<TScope, TDevice> extends never ? never : []
): DeviceQuery<TScope, TDevice>;
export function $<TScope extends Scope, TDevice extends UnknownDevice>(
  ...queries: Extract<
    ScopeToQueriesForDevice<TScope, TDevice>,
    // at least 6 queries to match
    [string, string, string, string, string, string, ...string[]]
  >
): DeviceQuery<TScope, TDevice>;
export function $(...queries: string[]): UnknownDeviceQuery {
  throw new Error('Not implemented');
}

export type NextQueryForDevice<
  TScope extends Scope,
  TDevice extends UnknownDevice,
  TQueries extends string[],
> = NextQuery<ScopeTreeForDevice<TScope, TDevice>, TQueries>;

export type ScopeTreeForDevice<
  TScope extends Scope,
  TDevice extends UnknownDevice,
> = {
  [TName in keyof TScope[types]['scopes']]: ScopeTreeForDevice<
    Extract<TScope[types]['scopes'][TName], Scope>,
    TDevice
  >;
} extends infer TTree
  ? TTree[keyof TTree] extends never
    ? // no sub scope with specified device, check current scope
      TScope[types]['devices'][keyof TScope[types]['devices']] extends infer TScopeDevice
      ? TScopeDevice extends never
        ? never
        : TScopeDevice extends TDevice
        ? true
        : never
      : never
    : Pick<
        TTree,
        {
          [TName in keyof TTree]: TTree[TName] extends never ? never : TName;
        }[keyof TTree]
      >
  : never;

type NextQuery<
  TScopeTree,
  TQueries extends string[],
> = TScopeTree extends object // distribute over union
  ? TQueries extends []
    ? RecursiveSubScopeNames<TScopeTree>
    : TQueries extends [
        infer TQuery extends string,
        ...infer TRestQueries extends string[],
      ]
    ? NextQuery<RecursiveSubScope<TScopeTree, TQuery>, TRestQueries>
    : never
  : never;

type RecursiveSubScope<
  TScopeTree,
  TQuery extends string,
> = TScopeTree extends object
  ? {
      [TName in keyof TScopeTree]:
        | (TQuery extends TName ? TScopeTree[TQuery] : never)
        | RecursiveSubScope<TScopeTree[TName], TQuery>;
    }[keyof TScopeTree]
  : never;

type RecursiveSubScopeNames<TScopeTree> = TScopeTree extends object
  ?
      | (keyof TScopeTree & string)
      | {
          [TName in keyof TScopeTree]: RecursiveSubScopeNames<
            TScopeTree[TName]
          >;
        }[keyof TScopeTree]
  : never;

/**
 * Type checking works but, intellisense doesn't work well with this solution,
 * the behavior is more like an array type of unions instead of tuple type.
 *
 * So only use this if query elements reached a certain number.
 */
type ScopeToQueriesForDevice<
  TScope extends Scope,
  TDevice extends UnknownDevice,
> = ScopeTreeToQueries<ScopeTreeForDevice<TScope, TDevice>>;

type ScopeTreeToQueries<TScopeTree> =
  | []
  | [TScopeTree extends object ? keyof TScopeTree & string : never]
  | {
      [TName in keyof TScopeTree]: TScopeTree[TName] extends infer TSubTree
        ? keyof TSubTree extends never
          ? never
          : ScopeTreeToQueries<TSubTree> extends infer TSubQueries extends
              string[]
          ? [TName, ...TSubQueries] | TSubQueries
          : never
        : never;
    }[keyof TScopeTree];
