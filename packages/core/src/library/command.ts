export abstract class Command {
  declare private readonly commandBrand: void;

  toLogString(): string {
    return this.constructor.name;
  }

  supersedes(_command: Command): boolean {
    return false;
  }
}

/** A desired-state command whose effect can be compared with state and commands. */
export abstract class StatefulCommand extends Command {
  override supersedes(command: Command): boolean {
    return command.constructor === this.constructor;
  }
}

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
