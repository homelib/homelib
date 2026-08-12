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

  turnOn(): this {
    this.endpoint.turnOn();
    return this;
  }

  turnOff(): this {
    this.endpoint.turnOff();
    return this;
  }

  /** Enqueues turn-on only when the currently observed `on` state is false. */
  ensureOn(): this {
    if (this.on) {
      return this;
    }

    return this.turnOn();
  }

  setWindMode(value: FanWindMode): this {
    this.endpoint.setWindMode(value);
    return this;
  }

  /**
   * Sets fan speed using a normalized ratio from 0 to 1.
   * A value of 0 turns the fan off.
   */
  setSpeed(value: number): this {
    if (value === 0) {
      return this.turnOff();
    } else {
      this.endpoint.setSpeed(value);
      return this;
    }
  }

  setHorizontalSwing(value: boolean): this {
    this.endpoint.setHorizontalSwing(value);
    return this;
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

  turnOn(): this {
    return this.enqueueCommand(new SetFanOnCommand(true));
  }

  turnOff(): this {
    return this.enqueueCommand(new SetFanOnCommand(false));
  }

  /** Enqueues turn-on only when the currently observed `on` state is false. */
  ensureOn(): this {
    if (this.on) {
      return this;
    }

    return this.turnOn();
  }

  setWindMode(value: FanWindMode): this {
    return this.enqueueCommand(new SetFanWindModeCommand(value));
  }

  /**
   * Sets fan speed using a normalized ratio from 0 to 1.
   * A value of 0 turns the fan off.
   */
  setSpeed(value: number): this {
    if (value === 0) {
      return this.turnOff();
    } else {
      return this.enqueueCommand(new SetFanSpeedCommand(value));
    }
  }

  setHorizontalSwing(value: boolean): this {
    return this.enqueueCommand(new SetFanHorizontalSwingCommand(value));
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
