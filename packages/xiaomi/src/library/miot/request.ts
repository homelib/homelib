export abstract class MiotRequest {
  declare private readonly requestBrand: void;

  toLogString(): string {
    return this.constructor.name;
  }
}

export class MiotSetPropertyRequest extends MiotRequest {
  constructor(
    readonly property: MiotProperty,
    readonly value: unknown,
  ) {
    super();
  }

  override toLogString(): string {
    const {did, siid, piid} = this.property;

    return `miot set did=${did} siid=${siid} piid=${piid}`;
  }
}

export type MiotExecutionRequest = MiotSetPropertyRequest;

export type MiotProperty = {
  readonly did: string;
  readonly siid: number;
  readonly piid: number;
};
