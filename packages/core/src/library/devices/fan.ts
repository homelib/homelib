import {computed} from 'mobx';

import {Command} from '../command.js';
import {Device, type DeviceEntry} from '../device.js';
import {Endpoint, type EndpointConnection} from '../endpoint.js';

export class Fan extends Device {
  protected readonly endpoint: FanEndpoint;

  @computed
  get on(): boolean | undefined {
    return this.endpoint.on;
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
}

export class FanEndpoint<
  TConnection extends FanEndpointConnection = FanEndpointConnection,
> extends Endpoint<FanEndpointCommand, TConnection> {
  @computed
  get on(): boolean | undefined {
    return this.connection?.on;
  }

  turnOn(): void {
    this.enqueueCommand(new SetFanOnCommand(true));
  }

  turnOff(): void {
    this.enqueueCommand(new SetFanOnCommand(false));
  }
}

export type FanEndpointConnection = EndpointConnection<FanEndpointCommand> & {
  readonly on: boolean | undefined;
};

export abstract class FanCommand extends Command {}

export class SetFanOnCommand extends FanCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetFanOnCommand;
  }
}

export type FanEndpointCommand = SetFanOnCommand;
