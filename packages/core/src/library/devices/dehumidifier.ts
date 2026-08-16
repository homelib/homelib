import {computed} from 'mobx';

import type {Temperature} from '../atomics/index.js';
import {StatefulCommand} from '../command.js';
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

  setMode(value: DehumidifierMode): this {
    this.endpoint.setMode(value);
    return this;
  }

  /** Sets target relative humidity using a normalized ratio from 0 to 1. */
  setTargetHumidity(relativeHumidity: number): this {
    this.endpoint.setTargetHumidity(relativeHumidity);
    return this;
  }
}

export class DehumidifierEndpoint<
  TConnection extends DehumidifierEndpointConnection =
    DehumidifierEndpointConnection,
> extends Endpoint<DehumidifierEndpointCommand, TConnection> {
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
      targetRelativeHumidity: this.targetRelativeHumidity,
      temperatureCelsius: this.temperature?.celsius,
      relativeHumidity: this.relativeHumidity,
    };
  }

  turnOn(): this {
    return this.enqueueCommand(new SetDehumidifierOnCommand(true));
  }

  turnOff(): this {
    return this.enqueueCommand(new SetDehumidifierOnCommand(false));
  }

  setMode(value: DehumidifierMode): this {
    return this.enqueueCommand(new SetDehumidifierModeCommand(value));
  }

  /** Sets target relative humidity using a normalized ratio from 0 to 1. */
  setTargetHumidity(relativeHumidity: number): this {
    return this.enqueueCommand(
      new SetDehumidifierTargetHumidityCommand(relativeHumidity),
    );
  }
}

export type DehumidifierEndpointConnection =
  EndpointConnection<DehumidifierEndpointCommand> & {
    readonly temperature: Temperature | undefined;
    readonly relativeHumidity: number | undefined;
    readonly on: boolean;
    readonly mode: DehumidifierMode | undefined;
    /** Target relative humidity as a normalized ratio from 0 to 1. */
    readonly targetRelativeHumidity: number | undefined;
  };

export abstract class DehumidifierCommand extends StatefulCommand {}

export class SetDehumidifierOnCommand extends DehumidifierCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override toLogString(): string {
    return `set on=${this.value}`;
  }
}

export class SetDehumidifierModeCommand extends DehumidifierCommand {
  constructor(readonly value: DehumidifierMode) {
    super();
  }

  override toLogString(): string {
    return `set mode=${this.value}`;
  }
}

export class SetDehumidifierTargetHumidityCommand extends DehumidifierCommand {
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

export type DehumidifierEndpointCommand =
  | SetDehumidifierOnCommand
  | SetDehumidifierModeCommand
  | SetDehumidifierTargetHumidityCommand;
