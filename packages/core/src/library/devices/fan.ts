import {computed} from 'mobx';

import {StatefulCommand} from '../command.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';

export type FanMode = 'normal' | 'natural';

export class Fan extends Device {
  protected readonly endpoint: FanEndpoint;

  @computed
  get on(): boolean {
    return this.endpoint.on;
  }

  @computed
  get mode(): FanMode | undefined {
    return this.endpoint.mode;
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

  setMode(value: FanMode): this {
    this.endpoint.setMode(value);
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
  get mode(): FanMode | undefined {
    return this.connection?.mode;
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
      mode: this.mode,
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

  setMode(value: FanMode): this {
    return this.enqueueCommand(new SetFanModeCommand(value));
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
  readonly mode: FanMode | undefined;
  /** Fan speed as a normalized ratio from 0 to 1. */
  readonly speed: number | undefined;
  readonly horizontalSwing: boolean | undefined;
};

export abstract class FanCommand extends StatefulCommand {}

export class SetFanOnCommand extends FanCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override toLogString(): string {
    return `set on=${this.value}`;
  }
}

export class SetFanModeCommand extends FanCommand {
  constructor(readonly value: FanMode) {
    super();
  }

  override toLogString(): string {
    return `set mode=${this.value}`;
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

  override toLogString(): string {
    return `set speed=${this.value}`;
  }
}

export class SetFanHorizontalSwingCommand extends FanCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override toLogString(): string {
    return `set horizontalSwing=${this.value}`;
  }
}

export type FanEndpointCommand =
  | SetFanOnCommand
  | SetFanModeCommand
  | SetFanSpeedCommand
  | SetFanHorizontalSwingCommand;
