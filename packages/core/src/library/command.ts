export abstract class Command {
  declare private readonly commandBrand: void;

  supersedes(_command: Command): boolean {
    return false;
  }
}

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
