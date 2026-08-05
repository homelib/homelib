import {Command} from '@homelib/core';

export abstract class MiotCommand extends Command {}

export type MiotProperty = {
  readonly siid: number;
  readonly piid: number;
};

export class MiotSetPropertyCommand extends MiotCommand {
  constructor(
    readonly property: MiotProperty,
    readonly value: unknown,
  ) {
    super();
  }
}
