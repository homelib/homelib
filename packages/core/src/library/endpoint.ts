import {action, observable, reaction} from 'mobx';
import * as x from 'x-value';

import {type Command} from './command.js';
import type {Provider} from './provider.js';
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

export const EndpointId = x.string.nominal<'endpoint id'>();

export type EndpointId = x.TypeOf<typeof EndpointId>;

export type EndpointConnectionMetadata = {};

export abstract class EndpointConnection<
  TCommand extends Command,
  TProvider extends Provider<TCommand> = Provider<TCommand>,
  TMetadata extends EndpointConnectionMetadata = EndpointConnectionMetadata,
> {
  constructor(
    readonly provider: TProvider,
    readonly metadata: TMetadata,
  ) {}

  abstract get id(): string;

  abstract get online(): boolean;

  abstract processCommand(command: TCommand): Promise<void>;
}

export class EndpointConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
