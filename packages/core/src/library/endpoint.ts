import {action, comparer, computed, observable, reaction} from 'mobx';

import {type Command} from './command.js';
import {
  hasEndpointLogTarget,
  logEndpointCommand,
  logEndpointError,
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

  @action
  bindConnection(connection: TConnection | undefined): void {
    if (this.connection_ === connection) {
      return;
    }

    this.connectionReactionDisposer?.();
    this.logStateReactionDisposer?.();

    this.connection_ = connection;
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
          () => connection.ready,
          ready => {
            if (ready) {
              void this.processPendingCommands().catch(logEndpointError);
            }
          },
          {fireImmediately: true},
        )
      : undefined;
  }

  enqueueCommand(command: TCommand): void {
    this.pendingCommands = this.pendingCommands.filter(
      pendingCommand => !command.supersedes(pendingCommand),
    );

    this.pendingCommands.push(command);

    void this.processPendingCommands().catch(logEndpointError);
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

        try {
          logEndpointCommand(this, this.connection, command);
          await this.connection.processCommand(command);
        } catch (error) {
          if (error instanceof EndpointConnectionError) {
            await this.connectionErrorBackoff;
            continue;
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
}

export type EndpointConnectionMetadata = {};

export type EndpointLogState = Readonly<
  Record<string, string | number | boolean | undefined>
>;

export type EndpointReference = {
  readonly name: string;
  readonly ready: boolean;
};

export type EndpointConnection<in TCommand extends Command> = {
  readonly ready: boolean;
  readonly processCommand: (command: TCommand) => PromiseLike<void>;
  readonly toLogString?: () => string;
};

export type EndpointConnectionBinding = {
  bind(): void;
};

export function createEndpointConnectionBinding<
  TCommand extends Command,
  TConnection extends EndpointConnection<TCommand>,
>(
  endpoint: Endpoint<TCommand, TConnection>,
  connection: TConnection,
): EndpointConnectionBinding {
  return {
    bind() {
      endpoint.bindConnection(connection);
    },
  };
}

export class EndpointConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
