import type {types} from '@homelib/x';
import type {OmitValueWithType} from 'tslang';

import type {UnknownDevice} from './device/index.js';
import type {Scope} from './scope.js';

export class DeviceQuery<TScope extends Scope, TDevice extends UnknownDevice> {
  declare [types]: {
    scope: TScope;
    device: TDevice;
  };

  constructor(readonly queries: string[]) {}
}

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
export function $<TDevice extends UnknownDevice, TScope extends Scope>(
  ...args: ScopeTreeForDevice<TScope, TDevice> extends never ? never : []
): DeviceQuery<TScope, TDevice>;
export function $<
  TScope extends Scope,
  TDevice extends UnknownDevice,
  TQueries extends Extract<
    ScopeToQueriesForDevice<TScope, TDevice>,
    // at least 5 queries to match
    [string, string, string, string, string, ...string[]]
  >,
>(...queries: TQueries): DeviceQuery<TScope, TDevice>;
export function $(...queries: string[]): UnknownDeviceQuery {
  return new DeviceQuery(queries);
}

export type NextQueryForDevice<
  TScope extends Scope,
  TDevice,
  TQueries,
> = NextQuery<ScopeTreeForDevice<TScope, TDevice>, TQueries>;

type NextQuery<TScopeTree, TQueries> = TScopeTree extends true
  ? never
  : TQueries extends []
    ? RecursiveSubScopeNames<TScopeTree>
    : TQueries extends [infer TQuery, ...infer TRestQueries]
      ? NextQuery<RecursiveSubScope<TScopeTree, TQuery>, TRestQueries>
      : never;

type RecursiveSubScopeNames<TScopeTree> = TScopeTree extends true
  ? never
  :
      | (keyof TScopeTree & string)
      | RecursiveSubScopeNames<TScopeTree[keyof TScopeTree]>;

type RecursiveSubScope<TScopeTree, TQuery> = TScopeTree extends true
  ? never
  :
      | (TQuery extends keyof TScopeTree ? TScopeTree[TQuery] : never)
      | RecursiveSubScope<TScopeTree[keyof TScopeTree], TQuery>;

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

export type ScopeTreeForDevice<TScope extends Scope, TDevice> =
  OmitValueWithType<
    {
      [TName in keyof TScope[types]['scopes']]: ScopeTreeForDevice<
        Extract<TScope[types]['scopes'][TName], Scope>,
        TDevice
      >;
    } & {
      [TName in keyof TScope[types]['devices']]: TScope[types]['devices'][TName] extends TDevice
        ? true
        : never;
    },
    never
  > extends infer TTree
    ? keyof TTree extends never
      ? never
      : TTree
    : never;
