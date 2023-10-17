import type {Device} from './device.js';
import type {Scope} from './scopes/index.js';
import type {types} from './types.js';

export interface DeviceQuery<TDevice extends Device, TScope extends Scope> {}

export function $<
  TDevice extends Device,
  TScope extends Scope,
  const TQ1 extends NextQueryForDevice<TDevice, TScope, []>,
>(q1: TQ1): DeviceQuery<TDevice, TScope>;
export function $<
  TDevice extends Device,
  TScope extends Scope,
  const TQ1 extends NextQueryForDevice<TDevice, TScope, []>,
  const TQ2 extends NextQueryForDevice<TDevice, TScope, [TQ1]>,
>(q1: TQ1, q2: TQ2): DeviceQuery<TDevice, TScope>;
export function $<
  TDevice extends Device,
  TScope extends Scope,
  const TQ1 extends NextQueryForDevice<TDevice, TScope, []>,
  const TQ2 extends NextQueryForDevice<TDevice, TScope, [TQ1]>,
  const TQ3 extends NextQueryForDevice<TDevice, TScope, [TQ1, TQ2]>,
>(q1: TQ1, q2: TQ2, q3: TQ3): DeviceQuery<TDevice, TScope>;
export function $<
  TDevice extends Device,
  TScope extends Scope,
  const TQ1 extends NextQueryForDevice<TDevice, TScope, []>,
  const TQ2 extends NextQueryForDevice<TDevice, TScope, [TQ1]>,
  const TQ3 extends NextQueryForDevice<TDevice, TScope, [TQ1, TQ2]>,
  const TQ4 extends NextQueryForDevice<TDevice, TScope, [TQ1, TQ2, TQ3]>,
>(q1: TQ1, q2: TQ2, q3: TQ3, q4: TQ4): DeviceQuery<TDevice, TScope>;
export function $<
  TDevice extends Device,
  TScope extends Scope,
  const TQ1 extends NextQueryForDevice<TDevice, TScope, []>,
  const TQ2 extends NextQueryForDevice<TDevice, TScope, [TQ1]>,
  const TQ3 extends NextQueryForDevice<TDevice, TScope, [TQ1, TQ2]>,
  const TQ4 extends NextQueryForDevice<TDevice, TScope, [TQ1, TQ2, TQ3]>,
  const TQ5 extends NextQueryForDevice<TDevice, TScope, [TQ1, TQ2, TQ3, TQ4]>,
>(q1: TQ1, q2: TQ2, q3: TQ3, q4: TQ4, q5: TQ5): DeviceQuery<TDevice, TScope>;
export function $<TDevice extends Device, TScope extends Scope>(
  ...args: ScopeTreeForDevice<TScope, TDevice> extends never ? never : []
): DeviceQuery<TDevice, TScope>;
export function $<TScope extends Scope, TDevice extends Device>(
  ...queries: Extract<
    ScopeToQueriesForDevice<TScope, TDevice>,
    // at least 6 queries to match
    [string, string, string, string, string, string, ...string[]]
  >
): DeviceQuery<TDevice, TScope>;
export function $(...queries: string[]): DeviceQuery<Device, Scope> {
  throw new Error('Not implemented');
}

type NextQueryForDevice<
  TDevice extends Device,
  TScope extends Scope,
  TQueries extends string[],
> = NextQuery<ScopeTreeForDevice<TScope, TDevice>, TQueries>;

type ScopeTreeForDevice<TScope extends Scope, TDevice extends Device> = {
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
  TDevice extends Device,
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
