import * as x from 'x-value';

const DEVICE_SET = new Set<Device<unknown>>();

export abstract class Device<TCommand> {
  /** @internal */
  _connection: DeviceConnection<TCommand> | undefined;

  private pendingCommands: TCommand[] = [];

  constructor() {
    DEVICE_SET.add(this);
  }

  get connection(): DeviceConnection<TCommand> | undefined {
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

export const DeviceId = x.string.nominal<'device id'>();

export type DeviceId = x.TypeOf<typeof DeviceId>;

export abstract class DeviceConnection<TCommand> {
  abstract get id(): string;

  abstract get online(): boolean;

  abstract processCommand(command: TCommand): Promise<void>;

  async processCommands(commands: TCommand[]): Promise<void> {
    for (const command of commands) {
      await this.processCommand(command);
    }
  }
}
