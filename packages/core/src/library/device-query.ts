import type {Scope} from './scopes/index.js';
import type {types} from './types.js';

export interface DeviceQuery<TScope> {}

export function $<const TScope extends Scope>(): DeviceQuery<TScope>;
export function $<
  const TScope extends Scope,
  const TQ1 extends NextQuery<TScope, []>,
>(q1: TQ1): DeviceQuery<TScope>;
export function $<
  const TScope extends Scope,
  const TQ1 extends NextQuery<TScope, []>,
  const TQ2 extends NextQuery<TScope, [TQ1]>,
>(q1: TQ1, q2: TQ2): DeviceQuery<TScope>;
export function $<
  const TScope extends Scope,
  const TQ1 extends NextQuery<TScope, []>,
  const TQ2 extends NextQuery<TScope, [TQ1]>,
  const TQ3 extends NextQuery<TScope, [TQ1, TQ2]>,
>(q1: TQ1, q2: TQ2, q3: TQ3): DeviceQuery<TScope>;
export function $<
  const TScope extends Scope,
  const TQ1 extends NextQuery<TScope, []>,
  const TQ2 extends NextQuery<TScope, [TQ1]>,
  const TQ3 extends NextQuery<TScope, [TQ1, TQ2]>,
  const TQ4 extends NextQuery<TScope, [TQ1, TQ2, TQ3]>,
>(q1: TQ1, q2: TQ2, q3: TQ3, q4: TQ4): DeviceQuery<TScope>;
export function $<
  const TScope extends Scope,
  const TQ1 extends NextQuery<TScope, []>,
  const TQ2 extends NextQuery<TScope, [TQ1]>,
  const TQ3 extends NextQuery<TScope, [TQ1, TQ2]>,
  const TQ4 extends NextQuery<TScope, [TQ1, TQ2, TQ3]>,
  const TQ5 extends NextQuery<TScope, [TQ1, TQ2, TQ3, TQ4]>,
>(q1: TQ1, q2: TQ2, q3: TQ3, q4: TQ4, q5: TQ5): DeviceQuery<TScope>;
export function $<TScope extends Scope>(
  ...queries: ScopeToQueries<TScope> &
    // at least 6 queries to match
    [string, string, string, string, string, string, ...string[]]
): DeviceQuery<TScope>;
export function $(...queries: string[]): DeviceQuery<Scope> {
  throw new Error('Not implemented');
}

type NextQuery<
  TScope extends Scope,
  TQueries extends string[],
> = TScope extends Scope // distribute over union
  ? TQueries extends []
    ? RecursiveSubScopeNames<TScope>
    : TQueries extends [
        infer TQuery extends string,
        ...infer TRestQueries extends string[],
      ]
    ? NextQuery<RecursiveSubScope<TScope, TQuery>, TRestQueries>
    : never
  : never;

type RecursiveSubScope<
  TScope extends Scope,
  TQuery extends string,
> = TScope[types]['scopes'] extends infer TSubScopes
  ? {
      [TName in keyof TSubScopes]:
        | (TQuery extends TName ? TSubScopes[TQuery] : never)
        | RecursiveSubScope<TSubScopes[TName] & Scope, TQuery>;
    }[keyof TSubScopes]
  : never;

type RecursiveSubScopeNames<TScope extends Scope> =
  TScope[types]['scopes'] extends infer TSubScopes
    ?
        | (keyof TSubScopes & string)
        | {
            [TName in keyof TSubScopes]: RecursiveSubScopeNames<
              TSubScopes[TName] & Scope
            >;
          }[keyof TSubScopes]
    : never;

/**
 * Type checking works but, intellisense doesn't work well with this solution,
 * the behavior is more like an array type of unions instead of tuple type.
 */
type ScopeToQueries<TScope extends Scope> =
  | [keyof TScope[types]['scopes'] & string]
  | []
  | {
      [TName in keyof TScope[types]['scopes']]: TScope[types]['scopes'][TName] extends infer TSubScope extends
        Scope
        ? keyof TSubScope[types]['scopes'] extends never
          ? never
          : ScopeToQueries<TSubScope> extends infer TSubQueries extends string[]
          ? [TName, ...TSubQueries] | TSubQueries
          : never
        : never;
    }[keyof TScope[types]['scopes']];
