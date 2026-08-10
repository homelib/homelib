import {Command, type LightEndpointCommand} from '@homelib/core';

export abstract class MiotCommand extends Command {
  declare private readonly miotCommandBrand: void;
}

export class MiotPlaceholderCommand extends MiotCommand {}

export type MiotEndpointCommand = LightEndpointCommand | MiotPlaceholderCommand;
