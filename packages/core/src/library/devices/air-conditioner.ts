import {computed} from 'mobx';

import type {Temperature} from '../atomics/index.js';
import {StatefulCommand} from '../command.js';
import type {
  RelativeHumiditySource,
  TemperatureSource,
} from '../device/index.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';

export type AirConditionerMode = 'auto' | 'cool' | 'dry' | 'fan' | 'heat';

export type AirConditionerFanSpeed = 'auto' | number;

export class AirConditioner
  extends Device
  implements TemperatureSource, RelativeHumiditySource
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

  /** Automatic fan speed or a normalized manual speed from 0 to 1. */
  @computed
  get fanSpeed(): AirConditionerFanSpeed | undefined {
    return this.endpoint.fanSpeed;
  }

  @computed
  get targetTemperature(): Temperature | undefined {
    return this.endpoint.targetTemperature;
  }

  /** Target relative humidity as a normalized ratio from 0 to 1. */
  @computed
  get targetRelativeHumidity(): number | undefined {
    return this.endpoint.targetRelativeHumidity;
  }

  @computed
  get temperature(): Temperature | undefined {
    return this.endpoint.temperature;
  }

  /** Relative humidity as a normalized ratio from 0 to 1. */
  @computed
  get relativeHumidity(): number | undefined {
    return this.endpoint.relativeHumidity;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(AirConditionerEndpoint);
  }

  turnOn(): this {
    this.endpoint.turnOn();
    return this;
  }

  turnOff(): this {
    this.endpoint.turnOff();
    return this;
  }

  setMode(value: AirConditionerMode): this {
    this.endpoint.setMode(value);
    return this;
  }

  setFanSpeed(value: AirConditionerFanSpeed): this {
    this.endpoint.setFanSpeed(value);
    return this;
  }

  setTargetTemperature(value: Temperature): this {
    this.endpoint.setTargetTemperature(value);
    return this;
  }

  /** Sets target relative humidity using a normalized ratio from 0 to 1. */
  setTargetRelativeHumidity(relativeHumidity: number): this {
    this.endpoint.setTargetRelativeHumidity(relativeHumidity);
    return this;
  }
}

export class AirConditionerEndpoint<
  TConnection extends AirConditionerEndpointConnection =
    AirConditionerEndpointConnection,
> extends Endpoint<AirConditionerEndpointCommand, TConnection> {
  @computed
  get on(): boolean {
    return this.connection?.on ?? false;
  }

  @computed
  get mode(): AirConditionerMode | undefined {
    return this.connection?.mode;
  }

  /** Automatic fan speed or a normalized manual speed from 0 to 1. */
  @computed
  get fanSpeed(): AirConditionerFanSpeed | undefined {
    return this.connection?.fanSpeed;
  }

  @computed
  get targetTemperature(): Temperature | undefined {
    return this.connection?.targetTemperature;
  }

  /** Target relative humidity as a normalized ratio from 0 to 1. */
  @computed
  get targetRelativeHumidity(): number | undefined {
    return this.connection?.targetRelativeHumidity;
  }

  @computed
  get temperature(): Temperature | undefined {
    return this.connection?.temperature;
  }

  /** Relative humidity as a normalized ratio from 0 to 1. */
  @computed
  get relativeHumidity(): number | undefined {
    return this.connection?.relativeHumidity;
  }

  protected override get logState(): EndpointLogState {
    if (!this.ready) {
      return {ready: false};
    }

    return {
      ready: true,
      on: this.on,
      mode: this.mode,
      fanSpeed: this.fanSpeed,
      targetTemperatureCelsius: this.targetTemperature?.celsius,
      targetRelativeHumidity: this.targetRelativeHumidity,
      temperatureCelsius: this.temperature?.celsius,
      relativeHumidity: this.relativeHumidity,
    };
  }

  turnOn(): this {
    return this.enqueueCommand(new SetAirConditionerOnCommand(true));
  }

  turnOff(): this {
    return this.enqueueCommand(new SetAirConditionerOnCommand(false));
  }

  setMode(value: AirConditionerMode): this {
    return this.enqueueCommand(new SetAirConditionerModeCommand(value));
  }

  setFanSpeed(value: AirConditionerFanSpeed): this {
    return this.enqueueCommand(new SetAirConditionerFanSpeedCommand(value));
  }

  setTargetTemperature(value: Temperature): this {
    return this.enqueueCommand(
      new SetAirConditionerTargetTemperatureCommand(value),
    );
  }

  /** Sets target relative humidity using a normalized ratio from 0 to 1. */
  setTargetRelativeHumidity(relativeHumidity: number): this {
    return this.enqueueCommand(
      new SetAirConditionerTargetRelativeHumidityCommand(relativeHumidity),
    );
  }
}

export type AirConditionerEndpointConnection =
  EndpointConnection<AirConditionerEndpointCommand> & {
    readonly temperature: Temperature | undefined;
    readonly relativeHumidity: number | undefined;
    readonly on: boolean;
    readonly mode: AirConditionerMode | undefined;
    /** Automatic fan speed or a normalized manual speed from 0 to 1. */
    readonly fanSpeed: AirConditionerFanSpeed | undefined;
    readonly targetTemperature: Temperature | undefined;
    /** Target relative humidity as a normalized ratio from 0 to 1. */
    readonly targetRelativeHumidity: number | undefined;
  };

export abstract class AirConditionerCommand extends StatefulCommand {}

export class SetAirConditionerOnCommand extends AirConditionerCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override toLogString(): string {
    return `set on=${this.value}`;
  }
}

export class SetAirConditionerModeCommand extends AirConditionerCommand {
  constructor(readonly value: AirConditionerMode) {
    super();
  }

  override toLogString(): string {
    return `set mode=${this.value}`;
  }
}

export class SetAirConditionerFanSpeedCommand extends AirConditionerCommand {
  /** Automatic fan speed or a normalized manual speed from 0 to 1. */
  constructor(readonly value: AirConditionerFanSpeed) {
    super();

    if (value !== 'auto' && typeof value !== 'number') {
      throw new TypeError(
        'Air conditioner fan speed must be "auto" or a number.',
      );
    }

    if (
      typeof value === 'number' &&
      (!Number.isFinite(value) || value < 0 || value > 1)
    ) {
      throw new RangeError(
        'Air conditioner fan speed must be "auto" or a finite number from 0 to 1.',
      );
    }
  }

  override toLogString(): string {
    return `set fanSpeed=${this.value}`;
  }
}

export class SetAirConditionerTargetTemperatureCommand extends AirConditionerCommand {
  constructor(readonly value: Temperature) {
    super();
  }

  override toLogString(): string {
    return `set targetTemperatureCelsius=${this.value.celsius}`;
  }
}

export class SetAirConditionerTargetRelativeHumidityCommand extends AirConditionerCommand {
  /** A normalized relative-humidity ratio from 0 to 1. */
  constructor(readonly relativeHumidity: number) {
    super();

    if (
      !Number.isFinite(relativeHumidity) ||
      relativeHumidity < 0 ||
      relativeHumidity > 1
    ) {
      throw new RangeError(
        'Target relative humidity must be a finite number from 0 to 1.',
      );
    }
  }

  override toLogString(): string {
    return `set targetRelativeHumidity=${this.relativeHumidity}`;
  }
}

export type AirConditionerEndpointCommand =
  | SetAirConditionerOnCommand
  | SetAirConditionerModeCommand
  | SetAirConditionerFanSpeedCommand
  | SetAirConditionerTargetTemperatureCommand
  | SetAirConditionerTargetRelativeHumidityCommand;
