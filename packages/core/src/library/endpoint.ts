import {action, computed, observable, reaction} from 'mobx';

import {type Command} from './command.js';
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

  constructor(readonly name = '') {}

  @computed
  get online(): boolean {
    return this.connection?.online ?? false;
  }

  protected get connection(): TConnection | undefined {
    return this.connection_;
  }

  @action
  bindConnection(connection: TConnection | undefined): void {
    if (this.connection_ === connection) {
      return;
    }

    this.connection_ = connection;

    this.connectionErrorBackoff.reset();

    this.connectionReactionDisposer?.();

    this.connectionReactionDisposer = connection
      ? reaction(
          () => connection.online,
          online => {
            if (online) {
              void this.processPendingCommands().catch(console.error);
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

    void this.processPendingCommands().catch(console.error);
  }

  private async processPendingCommands(): Promise<void> {
    if (this.processingCommands) {
      return;
    }

    this.processingCommands = true;

    while (
      this.connection &&
      this.connection.online &&
      this.pendingCommands.length > 0
    ) {
      const command = this.pendingCommands[0];

      try {
        await this.connection.processCommand(command);
      } catch (error) {
        console.error(error);

        if (error instanceof EndpointConnectionError) {
          await this.connectionErrorBackoff;
          continue;
        }
      }

      consumeCommand(this.pendingCommands, command);

      this.connectionErrorBackoff.reset();
    }

    this.processingCommands = false;

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

export type EndpointReference = {
  readonly name: string;
  readonly online: boolean;
};

export type EndpointConnection<in TCommand extends Command> = {
  readonly online: boolean;
  readonly processCommand: (command: TCommand) => PromiseLike<void>;
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
