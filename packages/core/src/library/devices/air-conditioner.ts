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

export type AirConditionerMode = 'auto' | 'cool' | 'dry' | 'fan' | 'heat';

export class AirConditioner
  extends Device
  implements TemperatureSensor, HumiditySensor
{
  protected readonly endpoint: AirConditionerEndpoint;

  @computed
  get on(): boolean {
    return this.endpoint.on;
  }

  @computed
  get mode(): AirConditionerMode | undefined {
    return this.endpoint.mode;
  }

  @computed
  get targetTemperature(): Temperature | undefined {
    return this.endpoint.targetTemperature;
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
    this.endpoint = this.getOrCreateEndpoint(AirConditionerEndpoint);
  }

  turnOn(): void {
    this.endpoint.turnOn();
  }

  turnOff(): void {
    this.endpoint.turnOff();
  }

  setMode(value: AirConditionerMode): void {
    this.endpoint.setMode(value);
  }

  setTargetTemperature(value: Temperature): void {
    this.endpoint.setTargetTemperature(value);
  }

  /** Sets target relative humidity using a normalized ratio from 0 to 1. */
  setTargetHumidity(value: number): void {
    this.endpoint.setTargetHumidity(value);
  }
}

export class AirConditionerEndpoint<
  TConnection extends AirConditionerEndpointConnection =
    AirConditionerEndpointConnection,
>
  extends Endpoint<AirConditionerEndpointCommand, TConnection>
  implements TemperatureSensor, HumiditySensor
{
  @computed
  get on(): boolean {
    return this.connection?.on ?? false;
  }

  @computed
  get mode(): AirConditionerMode | undefined {
    return this.connection?.mode;
  }

  @computed
  get targetTemperature(): Temperature | undefined {
    return this.connection?.targetTemperature;
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
      targetTemperatureCelsius: this.targetTemperature?.celsius,
      targetHumidity: this.targetHumidity,
      temperatureCelsius: this.temperature?.celsius,
      humidity: this.humidity,
    };
  }

  turnOn(): void {
    this.enqueueCommand(new SetAirConditionerOnCommand(true));
  }

  turnOff(): void {
    this.enqueueCommand(new SetAirConditionerOnCommand(false));
  }

  setMode(value: AirConditionerMode): void {
    this.enqueueCommand(new SetAirConditionerModeCommand(value));
  }

  setTargetTemperature(value: Temperature): void {
    this.enqueueCommand(new SetAirConditionerTargetTemperatureCommand(value));
  }

  /** Sets target relative humidity using a normalized ratio from 0 to 1. */
  setTargetHumidity(value: number): void {
    this.enqueueCommand(new SetAirConditionerTargetHumidityCommand(value));
  }
}

export type AirConditionerEndpointConnection =
  EndpointConnection<AirConditionerEndpointCommand> &
    TemperatureSensor &
    HumiditySensor & {
      readonly on: boolean;
      readonly mode: AirConditionerMode | undefined;
      readonly targetTemperature: Temperature | undefined;
      /** Target relative humidity as a normalized ratio from 0 to 1. */
      readonly targetHumidity: number | undefined;
    };

export abstract class AirConditionerCommand extends Command {}

export class SetAirConditionerOnCommand extends AirConditionerCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetAirConditionerOnCommand;
  }

  override toLogString(): string {
    return `set on=${this.value}`;
  }
}

export class SetAirConditionerModeCommand extends AirConditionerCommand {
  constructor(readonly value: AirConditionerMode) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetAirConditionerModeCommand;
  }

  override toLogString(): string {
    return `set mode=${this.value}`;
  }
}

export class SetAirConditionerTargetTemperatureCommand extends AirConditionerCommand {
  constructor(readonly value: Temperature) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetAirConditionerTargetTemperatureCommand;
  }

  override toLogString(): string {
    return `set targetTemperatureCelsius=${this.value.celsius}`;
  }
}

export class SetAirConditionerTargetHumidityCommand extends AirConditionerCommand {
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
    return command instanceof SetAirConditionerTargetHumidityCommand;
  }

  override toLogString(): string {
    return `set targetHumidity=${this.value}`;
  }
}

export type AirConditionerEndpointCommand =
  | SetAirConditionerOnCommand
  | SetAirConditionerModeCommand
  | SetAirConditionerTargetTemperatureCommand
  | SetAirConditionerTargetHumidityCommand;
