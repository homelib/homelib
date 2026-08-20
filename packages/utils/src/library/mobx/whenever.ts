import {
  type IReactionDisposer,
  comparer,
  autorun as mobxAutorun,
  reaction,
} from 'mobx';

type ReactiveCondition = () => boolean;

type ConditionalReactionValue<T> =
  {readonly active: false} | {readonly active: true; readonly value: T};

const INACTIVE_REACTION_VALUE = {active: false} as const;

export class Whenever {
  private constructor(
    private readonly conditions: readonly ReactiveCondition[],
  ) {}

  /** @internal */
  static create(condition: ReactiveCondition): Whenever {
    return new Whenever([condition]);
  }

  and(condition: ReactiveCondition): Whenever {
    return new Whenever([...this.conditions, condition]);
  }

  /** Runs and tracks `callback` while every condition is true. */
  autorun(callback: () => void): IReactionDisposer {
    return mobxAutorun(() => {
      if (this.conditions.every(condition => condition())) {
        callback();
      }
    });
  }

  /** Reacts to `expression` while every condition is true. */
  react<T>(
    expression: () => T,
    callback: (value: T, previousValue: T | undefined) => void,
  ): IReactionDisposer {
    return reaction<ConditionalReactionValue<T>, true>(
      () =>
        this.conditions.every(condition => condition())
          ? {active: true, value: expression()}
          : INACTIVE_REACTION_VALUE,
      (state, previousState) => {
        if (state.active) {
          callback(
            state.value,
            previousState?.active === true ? previousState.value : undefined,
          );
        }
      },
      {
        fireImmediately: true,
        equals: (state, previousState) => {
          if (!state.active || !previousState.active) {
            return state.active === previousState.active;
          }

          return comparer.default(state.value, previousState.value);
        },
      },
    );
  }

  then(callback: () => void): IReactionDisposer {
    if (arguments.length !== 1) {
      throw new TypeError('Whenever cannot be used as a promise.');
    }

    return createWheneverReaction(this.conditions, callback);
  }
}

/** Creates a condition chain without starting a reaction. */
export function whenever(condition: ReactiveCondition): Whenever;

/** Calls `callback` whenever `condition` becomes true. */
export function whenever(
  condition: ReactiveCondition,
  callback: () => void,
): IReactionDisposer;

export function whenever(
  condition: ReactiveCondition,
  callback?: () => void,
): Whenever | IReactionDisposer {
  if (callback === undefined) {
    return Whenever.create(condition);
  }

  return createWheneverReaction([condition], callback);
}

function createWheneverReaction(
  conditions: readonly ReactiveCondition[],
  callback: () => void,
): IReactionDisposer {
  return reaction(
    () => conditions.every(condition => condition()),
    value => {
      if (value) {
        callback();
      }
    },
    {fireImmediately: true},
  );
}
