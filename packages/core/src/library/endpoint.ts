import * as x from 'x-value';

import type {Command} from './command.js';

export abstract class Endpoint<TCommand extends Command> {
  /** @internal */
  _connection: EndpointConnection<TCommand> | undefined;

  private pendingCommands: TCommand[] = [];

  get connection(): EndpointConnection<TCommand> | undefined {
    return this._connection;
  }

  enqueueCommand(command: TCommand): void {
    this.pendingCommands.push(command);
  }

  consumeCommands(
    callback: (pendingCommands: TCommand[]) => TCommand[],
  ): TCommand[] {
    return callback(this.pendingCommands);
  }
}

export const EndpointId = x.string.nominal<'endpoint id'>();

export type EndpointId = x.TypeOf<typeof EndpointId>;

export abstract class EndpointConnection<TCommand extends Command> {
  abstract get id(): string;

  abstract get online(): boolean;

  abstract processCommand(command: TCommand): Promise<void>;

  async processCommands(commands: TCommand[]): Promise<void> {
    for (const command of commands) {
      await this.processCommand(command);
    }
  }
}
