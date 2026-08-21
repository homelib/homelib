import {action, comparer, computed, observable, reaction} from 'mobx';

import {type Command, CommandError, StatefulCommand} from './command.js';
import {
  type DeviceEvent,
  DeviceEventEmitter,
  type DeviceEventSource,
} from './event.js';
import {
  hasEndpointLogTarget,
  logEndpointCommand,
  logEndpointError,
  logEndpointEvent,
  logEndpointState,
} from './log.js';
import {ExponentialBackoff} from './utils/index.js';

export abstract class Endpoint<
  TCommand extends Command,
  TConnection extends EndpointConnection<TCommand> =
    EndpointConnection<TCommand>,
> {
  @observable.ref private accessor connection_: TConnection | undefined;

  private pendingCommands: TCommand[] = [];

  private processingCommands = false;

  private readonly connectionErrorBackoff = new ExponentialBackoff(100, 10_000);

  private connectionReactionDisposer: (() => void) | undefined;

  private logStateReactionDisposer: (() => void) | undefined;

  private acknowledgedCommands: AcknowledgedCommand[] = [];

  private commandsWithUncertainEffects: UncertainCommandEffect[] = [];

  private connectionStateGeneration = 0;

  private readonly eventBindings: EndpointEventBinding<TConnection>[] = [];

  constructor(readonly name = '') {}

  @computed
  get ready(): boolean {
    return this.connection?.ready ?? false;
  }

  protected get connection(): TConnection | undefined {
    return this.connection_;
  }

  protected get logState(): EndpointLogState {
    return {ready: this.ready};
  }

  /** Binds a stable event to this endpoint's current connection. */
  protected bindEvent<TEvent extends DeviceEvent<string>>(
    getEventSource: (connection: TConnection) => DeviceEventSource<TEvent>,
  ): DeviceEventSource<TEvent> {
    const target = new DeviceEventEmitter<TEvent>();
    const binding: EndpointEventBinding<TConnection> = {
      connect: connection =>
        getEventSource(connection)(event => {
          logEndpointEvent(this, connection, event);
          target.emit(event);
        }),
      dispose: undefined,
    };

    if (this.connection_ !== undefined) {
      binding.dispose = binding.connect(this.connection_);
    }

    this.eventBindings.push(binding);
    return target.createSubscriber();
  }

  @action
  bindConnection(connection: TConnection | undefined): void {
    if (this.connection_ === connection) {
      return;
    }

    this.rebindEvents(connection);

    this.connectionReactionDisposer?.();
    this.logStateReactionDisposer?.();
    this.clearCommandEffectState();

    this.connection_ = connection;
    this.connectionStateGeneration++;
    this.connectionErrorBackoff.reset();

    this.logStateReactionDisposer =
      connection !== undefined && hasEndpointLogTarget(this)
        ? reaction(
            () => this.logState,
            (state, previousState) => {
              logEndpointState(this, connection, state, previousState);
            },
            {equals: comparer.structural, fireImmediately: true},
          )
        : undefined;

    this.connectionReactionDisposer = connection
      ? reaction(
          () => ({
            ready: connection.ready,
            stateRevision: connection.stateRevision,
          }),
          (state, previousState) => {
            const {ready} = state;

            if (ready) {
              if (
                previousState !== undefined &&
                state.stateRevision !== previousState.stateRevision
              ) {
                this.reconcileCommandEffects();
              }

              void this.processPendingCommands().catch(logEndpointError);
            } else {
              this.connectionStateGeneration++;
              this.clearCommandEffectState();
            }
          },
          {equals: comparer.structural, fireImmediately: true},
        )
      : undefined;
  }

  private rebindEvents(connection: TConnection | undefined): void {
    const nextDisposerMap = new Map<
      EndpointEventBinding<TConnection>,
      () => void
    >();

    try {
      if (connection !== undefined) {
        for (const binding of this.eventBindings) {
          nextDisposerMap.set(binding, binding.connect(connection));
        }
      }
    } catch (error) {
      for (const dispose of nextDisposerMap.values()) {
        try {
          dispose();
        } catch (disposeError) {
          logEndpointError(disposeError);
        }
      }

      throw error;
    }

    for (const binding of this.eventBindings) {
      try {
        binding.dispose?.();
      } catch (error) {
        logEndpointError(error);
      }

      binding.dispose = nextDisposerMap.get(binding);
    }
  }

  @action
  unbindConnection(connection: TConnection): void {
    if (this.connection_ === connection) {
      this.bindConnection(undefined);
    }
  }

  enqueueCommand(command: TCommand): this {
    this.pendingCommands = this.pendingCommands.filter(
      pendingCommand => !command.supersedes(pendingCommand),
    );

    this.pendingCommands.push(command);

    void this.processPendingCommands().catch(logEndpointError);

    return this;
  }

  private async processPendingCommands(): Promise<void> {
    if (this.processingCommands) {
      return;
    }

    this.processingCommands = true;

    try {
      while (
        this.connection &&
        this.connection.ready &&
        this.pendingCommands.length > 0
      ) {
        const command = this.pendingCommands[0];
        const connection = this.connection;
        let executionStarted = false;
        let executionEffect: CommandEffect | undefined;
        let executionEffectObservationRevision: number | undefined;
        let executionStateGeneration: number | undefined;
        try {
          const execution = connection.prepareCommand(command);
          executionEffect = execution.effect;

          if (this.isStatefulCommandSatisfied(command, execution.effect)) {
            logEndpointCommand(this, connection, command, 'skip', execution);
            consumeCommand(this.pendingCommands, command);
            this.connectionErrorBackoff.reset();
            continue;
          }

          executionEffectObservationRevision =
            execution.effect?.observationRevision;
          executionStateGeneration = this.connectionStateGeneration;

          logEndpointCommand(this, connection, command, 'execute', execution);
          executionStarted = true;
          await execution.execute();

          if (command instanceof StatefulCommand) {
            this.removeAcknowledgedCommandsSupersededBy(command);
            this.removeUncertainEffectsSupersededBy(command);
          }

          if (
            command instanceof StatefulCommand &&
            execution.effect !== undefined &&
            this.connection === connection &&
            connection.ready
          ) {
            this.acknowledgeCommand(
              command,
              execution.effect,
              connection,
              executionEffectObservationRevision,
              executionStateGeneration,
            );
          } else if (
            command instanceof StatefulCommand &&
            execution.effect === undefined
          ) {
            this.markCommandEffectUncertain(
              command,
              undefined,
              connection,
              undefined,
              executionStateGeneration,
            );
          }
        } catch (error) {
          if (error instanceof EndpointConnectionError) {
            await this.connectionErrorBackoff;
            continue;
          }

          if (
            executionStarted &&
            command instanceof StatefulCommand &&
            !(error instanceof CommandError)
          ) {
            this.removeAcknowledgedCommandsSupersededBy(command);
            this.removeUncertainEffectsSupersededBy(command);
            this.markCommandEffectUncertain(
              command,
              executionEffect,
              connection,
              executionEffectObservationRevision,
              executionStateGeneration,
            );
          }

          logEndpointError(error);
        }

        consumeCommand(this.pendingCommands, command);

        this.connectionErrorBackoff.reset();
      }
    } finally {
      this.processingCommands = false;
    }

    function consumeCommand(
      pendingCommands: TCommand[],
      command: TCommand,
    ): void {
      if (pendingCommands.length > 0 && pendingCommands[0] === command) {
        pendingCommands.shift();
      }
    }
  }

  private isStatefulCommandSatisfied(
    command: TCommand,
    preparedEffect: CommandEffect | undefined,
  ): boolean {
    if (!(command instanceof StatefulCommand) || preparedEffect === undefined) {
      return false;
    }

    if (
      this.commandsWithUncertainEffects.some(uncertainEffect =>
        command.supersedes(uncertainEffect.command),
      )
    ) {
      return false;
    }

    let supersededAcknowledgedCommand = false;

    for (const acknowledgedCommand of this.acknowledgedCommands) {
      if (command.supersedes(acknowledgedCommand.command)) {
        supersededAcknowledgedCommand = true;

        if (acknowledgedCommand.effect.equals(preparedEffect)) {
          return true;
        }
      }
    }

    if (supersededAcknowledgedCommand) {
      return false;
    }

    return this.commandEffectMatches(preparedEffect);
  }

  private acknowledgeCommand(
    command: Command,
    effect: CommandEffect,
    connection: TConnection,
    observationRevision: number | undefined,
    connectionStateGeneration: number | undefined,
  ): void {
    if (
      observationRevision === undefined ||
      connectionStateGeneration === undefined ||
      !this.isCurrentConnectionState(connection, connectionStateGeneration)
    ) {
      return;
    }

    const currentObservationRevision = effect.observationRevision;

    if (currentObservationRevision !== observationRevision) {
      if (this.commandEffectMatches(effect)) {
        this.acknowledgedCommands.push({
          command,
          effect,
          observationRevision: currentObservationRevision,
        });
      } else {
        this.commandsWithUncertainEffects.push({
          command,
          effect,
          observationRevision: currentObservationRevision,
        });
      }

      return;
    }

    this.acknowledgedCommands.push({
      command,
      effect,
      observationRevision: currentObservationRevision,
    });
  }

  private removeAcknowledgedCommandsSupersededBy(command: Command): void {
    for (const acknowledgedCommand of [...this.acknowledgedCommands]) {
      if (command.supersedes(acknowledgedCommand.command)) {
        this.removeAcknowledgedCommand(acknowledgedCommand);
      }
    }
  }

  private removeUncertainEffectsSupersededBy(command: Command): void {
    this.commandsWithUncertainEffects =
      this.commandsWithUncertainEffects.filter(
        uncertainEffect => !command.supersedes(uncertainEffect.command),
      );
  }

  private markCommandEffectUncertain(
    command: Command,
    effect: CommandEffect | undefined,
    connection: TConnection,
    observationRevision: number | undefined,
    connectionStateGeneration: number | undefined,
  ): void {
    if (
      connectionStateGeneration === undefined ||
      !this.isCurrentConnectionState(connection, connectionStateGeneration)
    ) {
      return;
    }

    if (effect === undefined) {
      this.commandsWithUncertainEffects.push({command, effect});
      return;
    }

    if (observationRevision === undefined) {
      return;
    }

    const currentObservationRevision = effect.observationRevision;

    if (currentObservationRevision !== observationRevision) {
      if (this.commandEffectMatches(effect)) {
        this.acknowledgedCommands.push({
          command,
          effect,
          observationRevision: currentObservationRevision,
        });
      } else {
        this.commandsWithUncertainEffects.push({
          command,
          effect,
          observationRevision: currentObservationRevision,
        });
      }

      return;
    }

    this.commandsWithUncertainEffects.push({
      command,
      effect,
      observationRevision,
    });
  }

  private removeAcknowledgedCommand(
    acknowledgedCommand: AcknowledgedCommand,
  ): void {
    const index = this.acknowledgedCommands.indexOf(acknowledgedCommand);

    if (index === -1) {
      return;
    }

    this.acknowledgedCommands.splice(index, 1);
  }

  private reconcileCommandEffects(): void {
    for (const acknowledgedCommand of [...this.acknowledgedCommands]) {
      const observationRevision =
        acknowledgedCommand.effect.observationRevision;

      if (observationRevision === acknowledgedCommand.observationRevision) {
        continue;
      }

      if (this.commandEffectMatches(acknowledgedCommand.effect)) {
        acknowledgedCommand.observationRevision = observationRevision;
      } else {
        this.removeAcknowledgedCommand(acknowledgedCommand);
      }
    }

    for (const uncertainEffect of [...this.commandsWithUncertainEffects]) {
      if (
        uncertainEffect.effect === undefined ||
        uncertainEffect.observationRevision === undefined
      ) {
        continue;
      }

      const observationRevision = uncertainEffect.effect.observationRevision;

      if (observationRevision === uncertainEffect.observationRevision) {
        continue;
      }

      this.removeUncertainCommandEffect(uncertainEffect);

      if (this.commandEffectMatches(uncertainEffect.effect)) {
        this.acknowledgedCommands.push({
          command: uncertainEffect.command,
          effect: uncertainEffect.effect,
          observationRevision,
        });
      }
    }
  }

  private removeUncertainCommandEffect(
    uncertainEffect: UncertainCommandEffect,
  ): void {
    const index = this.commandsWithUncertainEffects.indexOf(uncertainEffect);

    if (index !== -1) {
      this.commandsWithUncertainEffects.splice(index, 1);
    }
  }

  private commandEffectMatches(effect: CommandEffect): boolean {
    try {
      return effect.matches(this);
    } catch (error) {
      logEndpointError(error);
      return false;
    }
  }

  private isCurrentConnectionState(
    connection: TConnection,
    connectionStateGeneration: number,
  ): boolean {
    return (
      this.connection === connection &&
      connection.ready &&
      this.connectionStateGeneration === connectionStateGeneration
    );
  }

  private clearCommandEffectState(): void {
    this.acknowledgedCommands = [];
    this.commandsWithUncertainEffects = [];
  }
}

export type EndpointConnectionMetadata = {};

type EndpointEventBinding<TConnection> = {
  readonly connect: (connection: TConnection) => () => void;
  dispose: (() => void) | undefined;
};

export type EndpointLogState = Readonly<
  Record<string, string | number | boolean | undefined>
>;

export type EndpointReference = {
  readonly name: string;
  readonly ready: boolean;
};

export type CommandEffect = {
  /**
   * Revision of the observations relevant to the result of {@link matches}.
   *
   * It must increase only after every state relevant to {@link matches} has
   * been observed since its previous revision, including observations equal to
   * the previous values and invalidations that make a state unknown. It must
   * remain unchanged for partial or unrelated updates. Every change must
   * accompany a change to the owning connection's `stateRevision`; equality
   * deliberately ignores this lifecycle value.
   */
  readonly observationRevision: number;
  /**
   * Whether this and `effect` describe the same desired state.
   *
   * Core only compares effects for stateful commands in the same effect slot,
   * as determined by `StatefulCommand.supersedes`, and from the same bound
   * endpoint connection lifecycle.
   */
  equals(effect: CommandEffect): boolean;
  /**
   * Whether the endpoint's currently available observations reflect this
   * effect. It must return false when any observation relevant to the effect is
   * unknown or has been invalidated.
   *
   * Core only calls this with the endpoint that owns the effect while its
   * current connection is ready. Readiness does not guarantee that any state
   * was observed successfully; implementations need not repeat connection
   * readiness or endpoint ownership checks.
   */
  matches(endpoint: EndpointReference): boolean;
};

export type CommandExecution = {
  /** The desired state effect, available before execution for noop detection. */
  readonly effect?: CommandEffect;
  /** Starts the externally observable command execution. */
  readonly execute: () => PromiseLike<void>;
  /**
   * Describes the prepared execution, reflecting any normalization the
   * connection applied. Core prefers it over the command description when
   * logging command actions.
   */
  readonly toLogString?: () => string;
};

export type EndpointConnection<in TCommand extends Command> = {
  /**
   * Whether the connection is connected and has completed lifecycle
   * initialization. Readiness does not guarantee that any state property was
   * observed successfully; each property defines its own unknown or default
   * representation.
   */
  readonly ready: boolean;
  /**
   * Monotonically increases after every complete or incremental state update
   * and state-availability change, including equal observations and
   * invalidations that make a state unknown.
   */
  readonly stateRevision: number;
  /**
   * Validates and prepares an inert execution plan. External execution must not
   * begin until the returned `execute()` function is called.
   */
  readonly prepareCommand: (command: TCommand) => CommandExecution;
  readonly toLogString?: () => string;
};

type AcknowledgedCommand = {
  readonly command: Command;
  readonly effect: CommandEffect;
  observationRevision: number;
};

type UncertainCommandEffect = {
  readonly command: Command;
  readonly effect: CommandEffect | undefined;
  readonly observationRevision?: number;
};

export type EndpointConnectionBinding = {
  bind(): void;
  dispose(): PromiseLike<void>;
};

export function createEndpointConnectionBinding<
  TCommand extends Command,
  TConnection extends EndpointConnection<TCommand>,
>(
  endpoint: Endpoint<TCommand, TConnection>,
  connection: TConnection,
  disposeConnection: () => void | PromiseLike<void> = () => undefined,
): EndpointConnectionBinding {
  let bound = false;
  let disposePromise: Promise<void> | undefined;

  return {
    bind() {
      if (disposePromise !== undefined) {
        throw new Error('Cannot bind a disposed endpoint connection.');
      }

      bound = true;
      endpoint.bindConnection(connection);
    },
    dispose() {
      disposePromise ??= (async () => {
        const errors: unknown[] = [];

        if (bound) {
          bound = false;

          try {
            endpoint.unbindConnection(connection);
          } catch (error) {
            errors.push(error);
          }
        }

        try {
          await disposeConnection();
        } catch (error) {
          errors.push(error);
        }

        if (errors.length === 1) {
          throw errors[0];
        } else if (errors.length > 1) {
          throw new AggregateError(
            errors,
            'Failed to dispose endpoint connection binding.',
          );
        }
      })();

      return disposePromise;
    },
  };
}

export class EndpointConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
