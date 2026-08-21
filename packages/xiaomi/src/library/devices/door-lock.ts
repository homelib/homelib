import {
  type CommandExecution,
  DeviceEventEmitter,
  DoorLockAlertEvent,
  type DoorLockAlertType,
  DoorLockEndpoint,
  type DoorLockEndpointConnection,
  type DoorLockOperationAction,
  DoorLockOperationEvent,
  type DoorLockOperationMethod,
  type DoorLockOperationPosition,
  type DoorState,
} from '@homelib/core';
import {computed, observable} from 'mobx';

import {
  MiotEndpointConnection,
  type MiotEndpointEventArgument,
  type MiotPropertyValueCodecDefinition,
} from '../endpoint-connection/index.js';
import {
  type MiotEventSchema,
  type MiotEventSchemaNames,
  type MiotPropertySchema,
  type MiotSpecEvent,
  matchesMiotUrnPattern,
} from '../miot/index.js';

const DOOR_STATE_CODEC_DEFINITION: MiotPropertyValueCodecDefinition<
  DoorState,
  number
> = {
  resolve({deviceType}) {
    if (
      matchesMiotUrnPattern(
        deviceType,
        'urn:miot-spec-v2:device:lock:0000A038:loock-v5:1',
      )
    ) {
      return {
        decode: raw => (raw === 0 ? 'open' : raw === 1 ? 'closed' : undefined),
        encode: rejectReadOnlyPropertyEncoding,
      };
    }

    if (
      matchesMiotUrnPattern(
        deviceType,
        'urn:miot-spec-v2:device:lock:0000A038:xiaomi-b03:1',
      )
    ) {
      return {
        decode: decodeXiaomiB03DoorState,
        encode: rejectReadOnlyPropertyEncoding,
      };
    }

    return undefined;
  },
};

const DOOR_LOCKED_CODEC_DEFINITION: MiotPropertyValueCodecDefinition<
  boolean,
  number
> = {
  resolve({deviceType}) {
    if (
      !matchesMiotUrnPattern(
        deviceType,
        'urn:miot-spec-v2:device:lock:0000A038:xiaomi-b03:1',
      )
    ) {
      return undefined;
    }

    return {
      decode: decodeXiaomiB03Locked,
      encode: rejectReadOnlyPropertyEncoding,
    };
  },
};

const LOCK_STATUS_CODEC_DEFINITION: MiotPropertyValueCodecDefinition<
  boolean,
  number
> = {
  resolve({deviceType}) {
    if (
      !matchesMiotUrnPattern(
        deviceType,
        'urn:miot-spec-v2:device:lock:0000A038:loock-v5:1',
      )
    ) {
      return undefined;
    }

    return {
      // loock-v5 publishes only Open (0) and Others (255). Others is not
      // strong enough evidence that the lock is currently secured.
      decode: raw => (raw === 0 ? false : undefined),
      encode: rejectReadOnlyPropertyEncoding,
    };
  },
};

const BATTERY_LEVEL_CODEC_DEFINITION: MiotPropertyValueCodecDefinition<
  number,
  number
> = {
  resolve({deviceType}) {
    if (
      !matchesMiotUrnPattern(
        deviceType,
        'urn:miot-spec-v2:device:lock:0000A038:loock-v5:1,urn:miot-spec-v2:device:lock:0000A038:xiaomi-b03:1',
      )
    ) {
      return undefined;
    }

    return {
      decode: raw =>
        typeof raw === 'number' && Number.isFinite(raw) ? raw / 100 : undefined,
      encode: rejectReadOnlyPropertyEncoding,
    };
  },
};

/** Read-only MIoT door-lock support verified against loock-v5 and xiaomi-b03. */
export class MiotDoorLockEndpointConnection
  extends MiotEndpointConnection<
    never,
    typeof MiotDoorLockEndpointConnection.properties,
    typeof MiotDoorLockEndpointConnection.events
  >
  implements DoorLockEndpointConnection
{
  static readonly Endpoint = DoorLockEndpoint;

  static readonly properties = {
    'urn:miot-spec-v2:service:door:00007856': {
      'urn:miot-spec-v2:property:door-state:0000006B,urn:miot-spec-v2:property:status:00000007':
        {
          name: 'door-state',
          iid: {
            'urn:miot-spec-v2:device:lock:0000A038:loock-v5:1': 1,
            'urn:miot-spec-v2:device:lock:0000A038:xiaomi-b03:1': 1021,
          },
        },
    },
    'urn:miot-spec-v2:service:lock:00007855': {
      'urn:miot-spec-v2:property:status:00000007': {
        name: 'lock-status',
        iid: {
          'urn:miot-spec-v2:device:lock:0000A038:loock-v5:1': 5,
        },
        optional: true,
      },
    },
    'urn:miot-spec-v2:service:battery:00007805': {
      'urn:miot-spec-v2:property:battery-level:00000014': {
        name: 'battery-level',
        iid: {
          'urn:miot-spec-v2:device:lock:0000A038:loock-v5:1': 1,
          'urn:miot-spec-v2:device:lock:0000A038:xiaomi-b03:1': 1003,
        },
        optional: true,
      },
    },
  } as const satisfies MiotPropertySchema;

  static readonly events = {
    'urn:miot-spec-v2:service:lock:00007855': {
      'urn:miot-spec-v2:event:lock-event:00005033,urn:miot-spec-v2:event:lock-opened:0000500E':
        'lock-operation',
      'urn:miot-spec-v2:event:exception-occurred:00005011': 'lock-alert',
    },
  } as const satisfies MiotEventSchema;

  private readonly alertEvent = new DeviceEventEmitter<DoorLockAlertEvent>();

  private readonly operationEvent =
    new DeviceEventEmitter<DoorLockOperationEvent>();

  readonly onDoorLockAlert = this.alertEvent.createSubscriber();

  readonly onDoorLockOperation = this.operationEvent.createSubscriber();

  private readonly multiplexesDoorAndLockState = matchesMiotUrnPattern(
    this.metadata.device.urn,
    'urn:miot-spec-v2:device:lock:0000A038:xiaomi-b03:1',
  );

  @observable private accessor multiplexedDoorState: DoorState | undefined;

  @observable private accessor multiplexedLocked: boolean | undefined;

  private readonly batteryLevelBinding = this.bindPropertyValue(
    'battery-level',
    BATTERY_LEVEL_CODEC_DEFINITION,
  );

  private readonly doorLockedBinding = this.bindPropertyValue(
    'door-state',
    DOOR_LOCKED_CODEC_DEFINITION,
  );

  private readonly doorStateBinding = this.bindPropertyValue(
    'door-state',
    DOOR_STATE_CODEC_DEFINITION,
  );

  private readonly lockStatusBinding = this.bindPropertyValue(
    'lock-status',
    LOCK_STATUS_CODEC_DEFINITION,
  );

  @computed
  get batteryLevel(): number | undefined {
    return this.batteryLevelBinding?.read();
  }

  @computed
  get doorState(): DoorState | undefined {
    return this.multiplexesDoorAndLockState
      ? this.multiplexedDoorState
      : this.doorStateBinding?.read();
  }

  @computed
  get locked(): boolean | undefined {
    return (
      this.lockStatusBinding?.read() ??
      (this.multiplexesDoorAndLockState
        ? this.multiplexedLocked
        : this.doorLockedBinding?.read())
    );
  }

  protected override handlePropertyStateChange(name: string): void {
    if (name !== 'door-state' || !this.multiplexesDoorAndLockState) {
      return;
    }

    const doorState = this.doorStateBinding?.read();
    const locked = this.doorLockedBinding?.read();

    if (doorState !== undefined) {
      this.multiplexedDoorState = doorState;
    }

    if (locked !== undefined) {
      this.multiplexedLocked = locked;
    }
  }

  protected override handleEvent(
    name: MiotEventSchemaNames<typeof MiotDoorLockEndpointConnection.events>,
    event: MiotSpecEvent,
    args: readonly MiotEndpointEventArgument[],
  ): void {
    if (name === 'lock-operation') {
      const operation = this.decodeOperation(event, args);

      if (operation !== undefined) {
        this.operationEvent.emit(operation);
      }
    } else if (name === 'lock-alert') {
      const alertType = this.decodeAlert(args);

      if (alertType !== undefined) {
        this.alertEvent.emit(new DoorLockAlertEvent(alertType));
      }
    } else {
      throw new TypeError(`Unsupported MIoT door-lock event: ${name}.`);
    }
  }

  override prepareCommand(_command: never): CommandExecution {
    throw new TypeError('MIoT door lock does not support commands.');
  }

  private decodeOperation(
    event: MiotSpecEvent,
    args: readonly MiotEndpointEventArgument[],
  ): DoorLockOperationEvent | undefined {
    let action: DoorLockOperationAction | undefined;

    if (
      matchesMiotUrnPattern(
        event.type,
        'urn:miot-spec-v2:event:lock-opened:0000500E',
      )
    ) {
      action = 'unlock';
    } else {
      const rawAction = getNumericEventArgument(
        args,
        'urn:miot-spec-v2:property:lock-action:00000129',
      );

      action =
        rawAction === 1 || rawAction === 3
          ? 'lock'
          : rawAction === 2 || rawAction === 4
            ? 'unlock'
            : undefined;
    }

    if (action === undefined) {
      return undefined;
    }

    const methodRaw = getNumericEventArgument(
      args,
      'urn:miot-spec-v2:property:operation-method:00000096',
    );
    const operatorId = getNumericEventArgument(
      args,
      'urn:miot-spec-v2:property:operation-id:00000097',
    );
    const method = this.decodeOperationMethod(methodRaw);
    const positionRaw = getNumericEventArgument(
      args,
      'urn:miot-spec-v2:property:operation-position:00000128',
    );
    const position = this.decodeOperationPosition(positionRaw);

    return new DoorLockOperationEvent(action, method, operatorId, position);
  }

  private decodeOperationMethod(
    raw: number | undefined,
  ): DoorLockOperationMethod | undefined {
    if (
      matchesMiotUrnPattern(
        this.metadata.device.urn,
        'urn:miot-spec-v2:device:lock:0000A038:loock-v5:1',
      )
    ) {
      return new Map<number, DoorLockOperationMethod>([
        [0, 'bluetooth'],
        [1, 'pin'],
        [2, 'fingerprint'],
        [4, 'key'],
        [6, 'nfc'],
        [7, 'one-time-pin'],
        [8, 'double-verification'],
        [10, 'manual'],
      ]).get(raw ?? Number.NaN);
    }

    return new Map<number, DoorLockOperationMethod>([
      [1, 'mobile'],
      [2, 'fingerprint'],
      [3, 'pin'],
      [4, 'nfc'],
      [5, 'key'],
      [6, 'one-time-pin'],
      [7, 'periodic-pin'],
      [8, 'duress'],
      [9, 'inside-button'],
      [10, 'finger-vein'],
    ]).get(raw ?? Number.NaN);
  }

  private decodeOperationPosition(
    raw: number | undefined,
  ): DoorLockOperationPosition | undefined {
    if (
      !matchesMiotUrnPattern(
        this.metadata.device.urn,
        'urn:miot-spec-v2:device:lock:0000A038:xiaomi-b03:1',
      )
    ) {
      return undefined;
    }

    return raw === 1 ? 'inside' : raw === 2 ? 'outside' : undefined;
  }

  private decodeAlert(
    args: readonly MiotEndpointEventArgument[],
  ): DoorLockAlertType | undefined {
    const raw = getNumericEventArgument(
      args,
      'urn:miot-spec-v2:property:abnormal-condition:00000095',
    );

    if (
      matchesMiotUrnPattern(
        this.metadata.device.urn,
        'urn:miot-spec-v2:device:lock:0000A038:loock-v5:1',
      )
    ) {
      return new Map<number, DoorLockAlertType>([
        [0, 'failed-attempts'],
        [1, 'failed-attempts'],
        [3, 'tampering'],
        [4, 'reset'],
        [5, 'failed-attempts'],
        [6, 'foreign-object'],
        [7, 'key-left-in-lock'],
        [11, 'failed-attempts'],
        [16, 'sensor-error'],
      ]).get(raw ?? Number.NaN);
    }

    return new Map<number, DoorLockAlertType>([
      [1, 'failed-attempts'],
      [2, 'tampering'],
      [3, 'reset'],
      [4, 'low-battery'],
      [5, 'critical-battery'],
      [6, 'unexpected-inside-unlock'],
      [7, 'door-ajar'],
      [9, 'door-open-timeout'],
      [11, 'door-not-closed'],
      [12, 'unlock-error'],
    ]).get(raw ?? Number.NaN);
  }
}

function decodeXiaomiB03DoorState(raw: unknown): DoorState | undefined {
  if ([3, 19, 35, 51].includes(raw as number)) {
    return 'closed';
  } else if ([4, 6, 20, 22, 36, 38, 52, 54].includes(raw as number)) {
    return 'ajar';
  } else if ([5, 21, 37, 53].includes(raw as number)) {
    return 'open';
  }

  return undefined;
}

function decodeXiaomiB03Locked(raw: unknown): boolean | undefined {
  if ([1, 17, 33, 49].includes(raw as number)) {
    return true;
  } else if ([2, 18, 34, 50].includes(raw as number)) {
    return false;
  }

  return undefined;
}

function getNumericEventArgument(
  args: readonly MiotEndpointEventArgument[],
  propertyType: string,
): number | undefined {
  const matching = args.filter(({property}) =>
    matchesMiotUrnPattern(property.type, propertyType),
  );
  const [argument] = matching;

  if (matching.length > 1) {
    throw new TypeError(
      `Ambiguous MIoT door-lock event argument: ${propertyType}.`,
    );
  }

  return typeof argument?.value === 'number' && Number.isFinite(argument.value)
    ? argument.value
    : undefined;
}

function rejectReadOnlyPropertyEncoding(): never {
  throw new TypeError('MIoT door-lock properties are read-only.');
}
