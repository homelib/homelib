import {computed} from 'mobx';

import {Command} from '../command.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';

export class Light extends Device {
  protected readonly endpoint: LightEndpoint;

  @computed
  get on(): boolean {
    return this.endpoint.on;
  }

  /** Brightness as a normalized ratio from 0 to 1. */
  @computed
  get brightness(): number | undefined {
    return this.endpoint.brightness;
  }

  @computed
  get colorTemperature(): number | undefined {
    return this.endpoint.colorTemperature;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(LightEndpoint);
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

  /**
   * Sets brightness using a normalized ratio from 0 to 1.
   * A value of 0 turns the light off.
   */
  setBrightness(value: number): this {
    if (value === 0) {
      return this.turnOff();
    } else {
      this.endpoint.setBrightness(value);
      return this;
    }
  }

  setColorTemperature(value: number): this {
    this.endpoint.setColorTemperature(value);
    return this;
  }
}

export class LightEndpoint<
  TConnection extends LightEndpointConnection = LightEndpointConnection,
> extends Endpoint<LightEndpointCommand, TConnection> {
  @computed
  get on(): boolean {
    return this.connection?.on ?? false;
  }

  /** Brightness as a normalized ratio from 0 to 1. */
  @computed
  get brightness(): number | undefined {
    return this.connection?.brightness;
  }

  @computed
  get colorTemperature(): number | undefined {
    return this.connection?.colorTemperature;
  }

  protected override get logState(): EndpointLogState {
    if (!this.ready) {
      return {ready: false};
    }

    return {
      ready: true,
      on: this.on,
      brightness: this.brightness,
      colorTemperature: this.colorTemperature,
    };
  }

  turnOn(): this {
    return this.enqueueCommand(new SetLightOnCommand(true));
  }

  turnOff(): this {
    return this.enqueueCommand(new SetLightOnCommand(false));
  }

  /** Enqueues turn-on only when the currently observed `on` state is false. */
  ensureOn(): this {
    if (this.on) {
      return this;
    }

    return this.turnOn();
  }

  /**
   * Sets brightness using a normalized ratio from 0 to 1.
   * A value of 0 turns the light off.
   */
  setBrightness(value: number): this {
    if (value === 0) {
      return this.turnOff();
    } else {
      return this.enqueueCommand(new SetLightBrightnessCommand(value));
    }
  }

  setColorTemperature(value: number): this {
    return this.enqueueCommand(new SetLightColorTemperatureCommand(value));
  }
}

export type LightEndpointConnection =
  EndpointConnection<LightEndpointCommand> & {
    readonly on: boolean;
    /** Brightness as a normalized ratio from 0 to 1. */
    readonly brightness: number | undefined;
    readonly colorTemperature: number | undefined;
  };

export abstract class LightCommand extends Command {}

export class SetLightOnCommand extends LightCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetLightOnCommand;
  }

  override toLogString(): string {
    return `set on=${this.value}`;
  }
}

export class SetLightBrightnessCommand extends LightCommand {
  /** `value` is a normalized brightness ratio greater than 0 and at most 1. */
  constructor(readonly value: number) {
    super();

    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new RangeError(
        'Brightness must be a finite number greater than 0 and at most 1.',
      );
    }
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetLightBrightnessCommand;
  }

  override toLogString(): string {
    return `set brightness=${this.value}`;
  }
}

export class SetLightColorTemperatureCommand extends LightCommand {
  constructor(readonly value: number) {
    super();

    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(
        'Color temperature must be a finite number greater than 0.',
      );
    }
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetLightColorTemperatureCommand;
  }

  override toLogString(): string {
    return `set colorTemperature=${this.value}`;
  }
}

export type LightEndpointCommand =
  | SetLightOnCommand
  | SetLightBrightnessCommand
  | SetLightColorTemperatureCommand;
