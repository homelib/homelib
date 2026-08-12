import {computed} from 'mobx';

import {Command} from '../command.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';

export type FanWindMode = 'normal' | 'natural';

export class Fan extends Device {
  protected readonly endpoint: FanEndpoint;

  @computed
  get on(): boolean {
    return this.endpoint.on;
  }

  @computed
  get windMode(): FanWindMode | undefined {
    return this.endpoint.windMode;
  }

  /** Fan speed as a normalized ratio from 0 to 1. */
  @computed
  get speed(): number | undefined {
    return this.endpoint.speed;
  }

  @computed
  get horizontalSwing(): boolean | undefined {
    return this.endpoint.horizontalSwing;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(FanEndpoint);
  }

  turnOn(): void {
    this.endpoint.turnOn();
  }

  turnOff(): void {
    this.endpoint.turnOff();
  }

  setWindMode(value: FanWindMode): void {
    this.endpoint.setWindMode(value);
  }

  /**
   * Sets fan speed using a normalized ratio from 0 to 1.
   * A value of 0 turns the fan off.
   */
  setSpeed(value: number): void {
    this.endpoint.setSpeed(value);
  }

  setHorizontalSwing(value: boolean): void {
    this.endpoint.setHorizontalSwing(value);
  }
}

export class FanEndpoint<
  TConnection extends FanEndpointConnection = FanEndpointConnection,
> extends Endpoint<FanEndpointCommand, TConnection> {
  @computed
  get on(): boolean {
    return this.connection?.on ?? false;
  }

  @computed
  get windMode(): FanWindMode | undefined {
    return this.connection?.windMode;
  }

  /** Fan speed as a normalized ratio from 0 to 1. */
  @computed
  get speed(): number | undefined {
    return this.connection?.speed;
  }

  @computed
  get horizontalSwing(): boolean | undefined {
    return this.connection?.horizontalSwing;
  }

  protected override get logState(): EndpointLogState {
    if (!this.ready) {
      return {ready: false};
    }

    return {
      ready: true,
      on: this.on,
      windMode: this.windMode,
      speed: this.speed,
      horizontalSwing: this.horizontalSwing,
    };
  }

  turnOn(): void {
    this.enqueueCommand(new SetFanOnCommand(true));
  }

  turnOff(): void {
    this.enqueueCommand(new SetFanOnCommand(false));
  }

  setWindMode(value: FanWindMode): void {
    this.enqueueCommand(new SetFanWindModeCommand(value));
  }

  /**
   * Sets fan speed using a normalized ratio from 0 to 1.
   * A value of 0 turns the fan off.
   */
  setSpeed(value: number): void {
    if (value === 0) {
      this.enqueueCommand(new SetFanOnCommand(false));
    } else {
      this.enqueueCommand(new SetFanSpeedCommand(value));
    }
  }

  setHorizontalSwing(value: boolean): void {
    this.enqueueCommand(new SetFanHorizontalSwingCommand(value));
  }
}

export type FanEndpointConnection = EndpointConnection<FanEndpointCommand> & {
  readonly on: boolean;
  readonly windMode: FanWindMode | undefined;
  /** Fan speed as a normalized ratio from 0 to 1. */
  readonly speed: number | undefined;
  readonly horizontalSwing: boolean | undefined;
};

export abstract class FanCommand extends Command {}

export class SetFanOnCommand extends FanCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetFanOnCommand;
  }

  override toLogString(): string {
    return `set on=${this.value}`;
  }
}

export class SetFanWindModeCommand extends FanCommand {
  constructor(readonly value: FanWindMode) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetFanWindModeCommand;
  }

  override toLogString(): string {
    return `set windMode=${this.value}`;
  }
}

export class SetFanSpeedCommand extends FanCommand {
  /** `value` is a normalized fan-speed ratio greater than 0 and at most 1. */
  constructor(readonly value: number) {
    super();

    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new RangeError(
        'Fan speed must be a finite number greater than 0 and at most 1.',
      );
    }
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetFanSpeedCommand;
  }

  override toLogString(): string {
    return `set speed=${this.value}`;
  }
}

export class SetFanHorizontalSwingCommand extends FanCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetFanHorizontalSwingCommand;
  }

  override toLogString(): string {
    return `set horizontalSwing=${this.value}`;
  }
}

export type FanEndpointCommand =
  | SetFanOnCommand
  | SetFanWindModeCommand
  | SetFanSpeedCommand
  | SetFanHorizontalSwingCommand;
