import {computed} from 'mobx';

import type {BatteryLevelSource} from '../device/index.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';
import {DeviceEvent, type DeviceEventSource} from '../event.js';

/** The physical position of a door associated with a lock. */
export type DoorState = 'open' | 'closed' | 'ajar';

export type DoorLockOperationAction = 'lock' | 'unlock';

export type DoorLockOperationMethod =
  | 'bluetooth'
  | 'double-verification'
  | 'duress'
  | 'finger-vein'
  | 'fingerprint'
  | 'inside-button'
  | 'key'
  | 'manual'
  | 'mobile'
  | 'nfc'
  | 'one-time-pin'
  | 'periodic-pin'
  | 'pin';

export type DoorLockOperationPosition = 'inside' | 'outside';

export class DoorLockOperationEvent extends DeviceEvent<'doorLockOperation'> {
  constructor(
    readonly action: DoorLockOperationAction,
    readonly method?: DoorLockOperationMethod,
    /** Provider-local user or credential identifier, when reported. */
    readonly operatorId?: number,
    readonly position?: DoorLockOperationPosition,
  ) {
    super();
  }

  override toLogString(): string {
    return [
      'doorLockOperation',
      `action=${JSON.stringify(this.action)}`,
      this.method === undefined
        ? undefined
        : `method=${JSON.stringify(this.method)}`,
      this.position === undefined
        ? undefined
        : `position=${JSON.stringify(this.position)}`,
      this.operatorId === undefined
        ? undefined
        : `operatorId=${this.operatorId}`,
    ]
      .filter(value => value !== undefined)
      .join(' ');
  }
}

export type DoorLockAlertType =
  | 'critical-battery'
  | 'door-ajar'
  | 'door-not-closed'
  | 'door-open-timeout'
  | 'failed-attempts'
  | 'foreign-object'
  | 'key-left-in-lock'
  | 'low-battery'
  | 'reset'
  | 'sensor-error'
  | 'tampering'
  | 'unexpected-inside-unlock'
  | 'unlock-error';

export class DoorLockAlertEvent extends DeviceEvent<'doorLockAlert'> {
  constructor(readonly type: DoorLockAlertType) {
    super();
  }

  override toLogString(): string {
    return `doorLockAlert type=${JSON.stringify(this.type)}`;
  }
}

/** A read-only smart door lock and its associated door sensor. */
export class DoorLock extends Device implements BatteryLevelSource {
  protected readonly endpoint: DoorLockEndpoint;

  readonly onDoorLockAlert: DeviceEventSource<DoorLockAlertEvent>;

  readonly onDoorLockOperation: DeviceEventSource<DoorLockOperationEvent>;

  @computed
  get batteryLevel(): number | undefined {
    return this.endpoint.batteryLevel;
  }

  @computed
  get doorState(): DoorState | undefined {
    return this.endpoint.doorState;
  }

  @computed
  get locked(): boolean | undefined {
    return this.endpoint.locked;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(DoorLockEndpoint);
    this.onDoorLockAlert = this.endpoint.onDoorLockAlert;
    this.onDoorLockOperation = this.endpoint.onDoorLockOperation;
  }
}

export class DoorLockEndpoint<
  TConnection extends DoorLockEndpointConnection = DoorLockEndpointConnection,
> extends Endpoint<never, TConnection> {
  readonly onDoorLockAlert = this.bindEvent(
    connection => connection.onDoorLockAlert,
  );

  readonly onDoorLockOperation = this.bindEvent(
    connection => connection.onDoorLockOperation,
  );

  @computed
  get batteryLevel(): number | undefined {
    return this.connection?.batteryLevel;
  }

  @computed
  get doorState(): DoorState | undefined {
    return this.connection?.doorState;
  }

  @computed
  get locked(): boolean | undefined {
    return this.connection?.locked;
  }

  protected override get logState(): EndpointLogState {
    if (!this.ready) {
      return {ready: false};
    }

    return {
      ready: true,
      locked: this.locked,
      doorState: this.doorState,
      batteryLevel: this.batteryLevel,
    };
  }
}

export type DoorLockEndpointConnection = EndpointConnection<never> & {
  readonly batteryLevel: number | undefined;
  readonly doorState: DoorState | undefined;
  readonly locked: boolean | undefined;
  readonly onDoorLockAlert: DeviceEventSource<DoorLockAlertEvent>;
  readonly onDoorLockOperation: DeviceEventSource<DoorLockOperationEvent>;
};
