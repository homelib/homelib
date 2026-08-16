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

export class MiotInvokeActionRequest extends MiotRequest {
  /** Inputs must follow the order of the corresponding `MiotSpecAction.in`. */
  constructor(
    readonly action: MiotAction,
    readonly inputs: readonly MiotActionInput[],
  ) {
    super();

    if (new Set(inputs.map(input => input.piid)).size !== inputs.length) {
      throw new TypeError('Duplicate MIoT action input property.');
    }
  }

  override toLogString(): string {
    const {did, siid, aiid} = this.action;

    return `miot action did=${did} siid=${siid} aiid=${aiid}`;
  }
}

export type MiotExecutionRequest =
  MiotSetPropertyRequest | MiotInvokeActionRequest;

export type MiotAction = {
  readonly did: string;
  readonly siid: number;
  readonly aiid: number;
};

export type MiotEvent = {
  readonly did: string;
  readonly siid: number;
  readonly eiid: number;
};

/** One property value carried by a MIoT event occurrence. */
export type MiotEventArgument = {
  readonly piid: number;
  readonly value: unknown;
};

/**
 * Values carried by a MIoT event occurrence.
 *
 * Xiaomi Cloud identifies each value by property IID, while the local gateway
 * sends values positionally in the order declared by the event spec. Preserve
 * that distinction until the owning endpoint can resolve the event metadata.
 */
export type MiotEventArguments =
  | {
      readonly type: 'identified';
      readonly data: readonly MiotEventArgument[];
    }
  | {
      readonly type: 'positional';
      readonly data: readonly unknown[];
    };

export type MiotActionInput = {
  readonly piid: number;
  readonly value: unknown;
};

export function getMiotExecutionRequestDid(
  request: MiotExecutionRequest,
): string {
  return request instanceof MiotSetPropertyRequest
    ? request.property.did
    : request.action.did;
}

export type MiotProperty = {
  readonly did: string;
  readonly siid: number;
  readonly piid: number;
};
