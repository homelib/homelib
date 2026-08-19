import {computed} from 'mobx';

import type {Temperature} from '../atomics/index.js';
import {Command, StatefulCommand} from '../command.js';
import type {TemperatureSource} from '../device/index.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';

import {LightEndpoint} from './light.js';

export type BathHeaterMode = 'dry' | 'defog' | 'quick-defog' | 'quick-heat';

/** A bathroom heater with independently controlled lighting. */
export class BathHeater extends Device implements TemperatureSource {
  protected readonly endpoint: BathHeaterEndpoint;

  protected readonly lightEndpoint: LightEndpoint;

  @computed
  get lightOn(): boolean {
    return this.lightEndpoint.on;
  }

  /** Light brightness as a normalized ratio from 0 to 1. */
  @computed
  get lightBrightness(): number | undefined {
    return this.lightEndpoint.brightness;
  }

  @computed
  get mode(): BathHeaterMode | undefined {
    return this.endpoint.mode;
  }

  @computed
  get heating(): boolean {
    return this.endpoint.heating;
  }

  @computed
  get blowing(): boolean {
    return this.endpoint.blowing;
  }

  @computed
  get ventilating(): boolean {
    return this.endpoint.ventilating;
  }

  @computed
  get targetTemperature(): Temperature | undefined {
    return this.endpoint.targetTemperature;
  }

  @computed
  get temperature(): Temperature | undefined {
    return this.endpoint.temperature;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(BathHeaterEndpoint);
    this.lightEndpoint = this.getOrCreateEndpoint(LightEndpoint, 'light');
  }

  turnLightOn(): this {
    this.lightEndpoint.turnOn();
    return this;
  }

  turnLightOff(): this {
    this.lightEndpoint.turnOff();
    return this;
  }

  /** Sets light brightness using a normalized ratio, clamped by the provider. */
  setLightBrightness(value: number): this {
    this.lightEndpoint.setBrightness(value);
    return this;
  }

  setMode(value: BathHeaterMode): this {
    this.endpoint.setMode(value);
    return this;
  }

  setHeating(value: boolean): this {
    this.endpoint.setHeating(value);
    return this;
  }

  setBlowing(value: boolean): this {
    this.endpoint.setBlowing(value);
    return this;
  }

  setVentilating(value: boolean): this {
    this.endpoint.setVentilating(value);
    return this;
  }

  setTargetTemperature(value: Temperature): this {
    this.endpoint.setTargetTemperature(value);
    return this;
  }

  stop(): this {
    this.endpoint.stop();
    return this;
  }
}

export class BathHeaterEndpoint<
  TConnection extends BathHeaterEndpointConnection =
    BathHeaterEndpointConnection,
> extends Endpoint<BathHeaterEndpointCommand, TConnection> {
  @computed
  get mode(): BathHeaterMode | undefined {
    return this.connection?.mode;
  }

  @computed
  get heating(): boolean {
    return this.connection?.heating ?? false;
  }

  @computed
  get blowing(): boolean {
    return this.connection?.blowing ?? false;
  }

  @computed
  get ventilating(): boolean {
    return this.connection?.ventilating ?? false;
  }

  @computed
  get targetTemperature(): Temperature | undefined {
    return this.connection?.targetTemperature;
  }

  @computed
  get temperature(): Temperature | undefined {
    return this.connection?.temperature;
  }

  protected override get logState(): EndpointLogState {
    if (!this.ready) {
      return {ready: false};
    }

    return {
      ready: true,
      mode: this.mode,
      heating: this.heating,
      blowing: this.blowing,
      ventilating: this.ventilating,
      targetTemperatureCelsius: this.targetTemperature?.celsius,
      temperatureCelsius: this.temperature?.celsius,
    };
  }

  setMode(value: BathHeaterMode): this {
    return this.enqueueCommand(new SetBathHeaterModeCommand(value));
  }

  setHeating(value: boolean): this {
    return this.enqueueCommand(new SetBathHeaterHeatingCommand(value));
  }

  setBlowing(value: boolean): this {
    return this.enqueueCommand(new SetBathHeaterBlowingCommand(value));
  }

  setVentilating(value: boolean): this {
    return this.enqueueCommand(new SetBathHeaterVentilatingCommand(value));
  }

  setTargetTemperature(value: Temperature): this {
    return this.enqueueCommand(
      new SetBathHeaterTargetTemperatureCommand(value),
    );
  }

  stop(): this {
    return this.enqueueCommand(new StopBathHeaterCommand());
  }
}

export type BathHeaterEndpointConnection =
  EndpointConnection<BathHeaterEndpointCommand> & {
    readonly mode: BathHeaterMode | undefined;
    readonly heating: boolean;
    readonly blowing: boolean;
    readonly ventilating: boolean;
    readonly targetTemperature: Temperature | undefined;
    readonly temperature: Temperature | undefined;
  };

export abstract class BathHeaterStatefulCommand extends StatefulCommand {}

export class SetBathHeaterModeCommand extends BathHeaterStatefulCommand {
  constructor(readonly value: BathHeaterMode) {
    super();

    if (!BATH_HEATER_MODE_SET.has(value)) {
      throw new TypeError(`Unsupported bath heater mode: ${String(value)}.`);
    }
  }

  override toLogString(): string {
    return `set mode=${this.value}`;
  }
}

export class SetBathHeaterHeatingCommand extends BathHeaterStatefulCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override toLogString(): string {
    return `set heating=${this.value}`;
  }
}

export class SetBathHeaterBlowingCommand extends BathHeaterStatefulCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override toLogString(): string {
    return `set blowing=${this.value}`;
  }
}

export class SetBathHeaterVentilatingCommand extends BathHeaterStatefulCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override toLogString(): string {
    return `set ventilating=${this.value}`;
  }
}

export class SetBathHeaterTargetTemperatureCommand extends BathHeaterStatefulCommand {
  constructor(readonly value: Temperature) {
    super();
  }

  override toLogString(): string {
    return `set targetTemperatureCelsius=${this.value.celsius}`;
  }
}

/** Stops the current bathroom-heater operation without assuming final state. */
export class StopBathHeaterCommand extends Command {
  override toLogString(): string {
    return 'stop';
  }
}

export type BathHeaterEndpointCommand =
  | SetBathHeaterModeCommand
  | SetBathHeaterHeatingCommand
  | SetBathHeaterBlowingCommand
  | SetBathHeaterVentilatingCommand
  | SetBathHeaterTargetTemperatureCommand
  | StopBathHeaterCommand;

const BATH_HEATER_MODE_SET: ReadonlySet<string> = new Set([
  'dry',
  'defog',
  'quick-defog',
  'quick-heat',
]);
