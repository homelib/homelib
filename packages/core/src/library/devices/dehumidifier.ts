import {computed} from 'mobx';

import type {Temperature} from '../atomics/index.js';
import {Command} from '../command.js';
import type {HumiditySensor, TemperatureSensor} from '../device/index.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';

export type DehumidifierMode = 'auto' | 'sleep' | 'laundry';

export class Dehumidifier
  extends Device
  implements TemperatureSensor, HumiditySensor
{
  protected readonly endpoint: DehumidifierEndpoint;

  @computed
  get on(): boolean {
    return this.endpoint.on;
  }

  @computed
  get mode(): DehumidifierMode | undefined {
    return this.endpoint.mode;
  }

  /** Target relative humidity as a normalized ratio from 0 to 1. */
  @computed
  get targetHumidity(): number | undefined {
    return this.endpoint.targetHumidity;
  }

  @computed
  get temperature(): Temperature | undefined {
    return this.endpoint.temperature;
  }

  /** Relative humidity as a normalized ratio from 0 to 1. */
  @computed
  get humidity(): number | undefined {
    return this.endpoint.humidity;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(DehumidifierEndpoint);
  }

  turnOn(): this {
    this.endpoint.turnOn();
    return this;
  }

  turnOff(): this {
    this.endpoint.turnOff();
    return this;
  }

  /** Queues turn-on only when the currently observed state is off. */
  ensureOn(): this {
    if (this.on) {
      return this;
    }

    return this.turnOn();
  }

  setMode(value: DehumidifierMode): this {
    this.endpoint.setMode(value);
    return this;
  }

  /** Sets target relative humidity using a normalized ratio from 0 to 1. */
  setTargetHumidity(value: number): this {
    this.endpoint.setTargetHumidity(value);
    return this;
  }
}

export class DehumidifierEndpoint<
  TConnection extends DehumidifierEndpointConnection =
    DehumidifierEndpointConnection,
>
  extends Endpoint<DehumidifierEndpointCommand, TConnection>
  implements TemperatureSensor, HumiditySensor
{
  @computed
  get on(): boolean {
    return this.connection?.on ?? false;
  }

  @computed
  get mode(): DehumidifierMode | undefined {
    return this.connection?.mode;
  }

  /** Target relative humidity as a normalized ratio from 0 to 1. */
  @computed
  get targetHumidity(): number | undefined {
    return this.connection?.targetHumidity;
  }

  @computed
  get temperature(): Temperature | undefined {
    return this.connection?.temperature;
  }

  /** Relative humidity as a normalized ratio from 0 to 1. */
  @computed
  get humidity(): number | undefined {
    return this.connection?.humidity;
  }

  protected override get logState(): EndpointLogState {
    if (!this.ready) {
      return {ready: false};
    }

    return {
      ready: true,
      on: this.on,
      mode: this.mode,
      targetHumidity: this.targetHumidity,
      temperatureCelsius: this.temperature?.celsius,
      humidity: this.humidity,
    };
  }

  turnOn(): this {
    return this.enqueueCommand(new SetDehumidifierOnCommand(true));
  }

  turnOff(): this {
    return this.enqueueCommand(new SetDehumidifierOnCommand(false));
  }

  /** Queues turn-on only when the currently observed state is off. */
  ensureOn(): this {
    if (this.on) {
      return this;
    }

    return this.turnOn();
  }

  setMode(value: DehumidifierMode): this {
    return this.enqueueCommand(new SetDehumidifierModeCommand(value));
  }

  /** Sets target relative humidity using a normalized ratio from 0 to 1. */
  setTargetHumidity(value: number): this {
    return this.enqueueCommand(new SetDehumidifierTargetHumidityCommand(value));
  }
}

export type DehumidifierEndpointConnection =
  EndpointConnection<DehumidifierEndpointCommand> &
    TemperatureSensor &
    HumiditySensor & {
      readonly on: boolean;
      readonly mode: DehumidifierMode | undefined;
      /** Target relative humidity as a normalized ratio from 0 to 1. */
      readonly targetHumidity: number | undefined;
    };

export abstract class DehumidifierCommand extends Command {}

export class SetDehumidifierOnCommand extends DehumidifierCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetDehumidifierOnCommand;
  }

  override toLogString(): string {
    return `set on=${this.value}`;
  }
}

export class SetDehumidifierModeCommand extends DehumidifierCommand {
  constructor(readonly value: DehumidifierMode) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetDehumidifierModeCommand;
  }

  override toLogString(): string {
    return `set mode=${this.value}`;
  }
}

export class SetDehumidifierTargetHumidityCommand extends DehumidifierCommand {
  /** `value` is a normalized relative-humidity ratio from 0 to 1. */
  constructor(readonly value: number) {
    super();

    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(
        'Target humidity must be a finite number from 0 to 1.',
      );
    }
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetDehumidifierTargetHumidityCommand;
  }

  override toLogString(): string {
    return `set targetHumidity=${this.value}`;
  }
}

export type DehumidifierEndpointCommand =
  | SetDehumidifierOnCommand
  | SetDehumidifierModeCommand
  | SetDehumidifierTargetHumidityCommand;
