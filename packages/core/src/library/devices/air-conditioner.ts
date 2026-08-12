import {computed} from 'mobx';

import {Command} from '../command.js';
import {Device, type DeviceEntry} from '../device.js';
import {Endpoint, type EndpointConnection} from '../endpoint.js';

export class AirConditioner extends Device {
  protected readonly endpoint: AirConditionerEndpoint;

  @computed
  get on(): boolean | undefined {
    return this.endpoint.on;
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
}

export class AirConditionerEndpoint<
  TConnection extends AirConditionerEndpointConnection =
    AirConditionerEndpointConnection,
> extends Endpoint<AirConditionerEndpointCommand, TConnection> {
  @computed
  get on(): boolean | undefined {
    return this.connection?.on;
  }

  turnOn(): void {
    this.enqueueCommand(new SetAirConditionerOnCommand(true));
  }

  turnOff(): void {
    this.enqueueCommand(new SetAirConditionerOnCommand(false));
  }
}

export type AirConditionerEndpointConnection =
  EndpointConnection<AirConditionerEndpointCommand> & {
    readonly on: boolean | undefined;
  };

export abstract class AirConditionerCommand extends Command {}

export class SetAirConditionerOnCommand extends AirConditionerCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetAirConditionerOnCommand;
  }
}

export type AirConditionerEndpointCommand = SetAirConditionerOnCommand;
