import {Command} from '@homelib/core';

export abstract class MiotCommand extends Command {
  declare private readonly miotCommandBrand: void;
}

export class MiotPlaceholderCommand extends MiotCommand {}
