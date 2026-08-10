export abstract class MiotRequest {
  declare private readonly requestBrand: void;
}

export class MiotSetPropertyRequest extends MiotRequest {
  constructor(
    readonly property: MiotProperty,
    readonly value: unknown,
  ) {
    super();
  }
}

export type MiotExecutionRequest = MiotSetPropertyRequest;

export type MiotProperty = {
  readonly did: string;
  readonly siid: number;
  readonly piid: number;
};
