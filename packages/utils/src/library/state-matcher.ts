export type StateMatcherDefinition<TState, TInput> = {
  readonly state: TState;
  readonly enter: (input: TInput) => boolean;
  readonly leave: (input: TInput) => boolean;
};

/**
 * Matches inputs to states while preserving the current state until its leave
 * predicate is satisfied.
 *
 * Definitions are checked in order when selecting the next state. Enter
 * predicates should cover the complete input space, while leave predicates can
 * define a wider boundary to provide hysteresis. After a definition is left,
 * that same definition is skipped while selecting the next state.
 */
export class StateMatcher<TState, TInput> {
  private currentDefinition: StateMatcherDefinition<TState, TInput> | undefined;

  constructor(
    private readonly definitions: readonly StateMatcherDefinition<
      TState,
      TInput
    >[],
  ) {}

  get state(): TState | undefined {
    return this.currentDefinition?.state;
  }

  update(input: TInput): {state: TState; changed: boolean} {
    const {currentDefinition} = this;

    if (currentDefinition && !currentDefinition.leave(input)) {
      return {state: currentDefinition.state, changed: false};
    }

    this.currentDefinition = undefined;

    for (const definition of this.definitions) {
      if (definition === currentDefinition) {
        continue;
      }

      if (definition.enter(input)) {
        this.currentDefinition = definition;
        return {state: definition.state, changed: true};
      }
    }

    throw new Error(
      `No matching state for input ${JSON.stringify(input)}; previous state: ${String(currentDefinition?.state)}.`,
    );
  }
}
