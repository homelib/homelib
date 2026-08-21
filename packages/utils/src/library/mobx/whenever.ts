import {$mobx, type IReactionDisposer, autorun, comparer, reaction} from 'mobx';

type ReactiveCondition = () => boolean;

type WheneverDisposer = () => void;

type WheneverCallback = () => void | WheneverDisposer;

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

  /** Alias for activating one MobX autorun while every condition is true. */
  autorun(callback: () => void): IReactionDisposer {
    return this.then(() => autorun(callback));
  }

  /** Alias for activating one immediate MobX reaction while conditions are true. */
  react<T>(
    expression: () => T,
    callback: (value: T, previousValue: T | undefined) => void,
  ): IReactionDisposer {
    return this.then(() =>
      reaction(expression, callback, {
        fireImmediately: true,
        equals: comparer.default,
      }),
    );
  }

  /**
   * Activates `callback` whenever every condition becomes true. Its returned
   * disposer runs when any condition becomes false.
   */
  then(callback: WheneverCallback): IReactionDisposer {
    if (arguments.length !== 1) {
      throw new TypeError('Whenever cannot be used as a promise.');
    }

    return createWheneverReaction(this.conditions, callback);
  }
}

/** Creates a condition chain without starting a reaction. */
export function whenever(condition: ReactiveCondition): Whenever;

/**
 * Calls `callback` whenever `condition` becomes true and disposes its returned
 * activation when the condition becomes false.
 */
export function whenever(
  condition: ReactiveCondition,
  callback: WheneverCallback,
): IReactionDisposer;

export function whenever(
  condition: ReactiveCondition,
  callback?: WheneverCallback,
): Whenever | IReactionDisposer {
  if (callback === undefined) {
    return Whenever.create(condition);
  }

  return createWheneverReaction([condition], callback);
}

function createWheneverReaction(
  conditions: readonly ReactiveCondition[],
  callback: WheneverCallback,
): IReactionDisposer {
  let activeDisposer: WheneverDisposer | undefined;
  let disposed = false;

  const deactivate = (): void => {
    const disposer = activeDisposer;
    activeDisposer = undefined;
    disposer?.();
  };
  const reactionDisposer = reaction(
    () => conditions.every(condition => condition()),
    value => {
      if (value) {
        activeDisposer = callback() ?? undefined;
      } else {
        deactivate();
      }
    },
    {fireImmediately: true},
  );

  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    reactionDisposer();
    deactivate();
  };

  return Object.assign(dispose, {[$mobx]: reactionDisposer[$mobx]});
}
