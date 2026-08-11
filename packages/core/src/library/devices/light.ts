import {computed} from 'mobx';

import {Command} from '../command.js';
import {Device, type DeviceEntry} from '../device.js';
import {Endpoint, type EndpointConnection} from '../endpoint.js';

export class Light extends Device {
  protected readonly endpoint: LightEndpoint;

  @computed
  get on(): boolean | undefined {
    return this.endpoint.on;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(LightEndpoint);
  }

  turnOn(): void {
    this.endpoint.turnOn();
  }

  turnOff(): void {
    this.endpoint.turnOff();
  }
}

export class LightEndpoint<
  TConnection extends LightEndpointConnection = LightEndpointConnection,
> extends Endpoint<LightEndpointCommand, TConnection> {
  @computed
  get on(): boolean | undefined {
    return this.connection?.on;
  }

  turnOn(): void {
    this.enqueueCommand(new SetLightOnCommand(true));
  }

  turnOff(): void {
    this.enqueueCommand(new SetLightOnCommand(false));
  }
}

export type LightEndpointConnection =
  EndpointConnection<LightEndpointCommand> & {
    readonly on: boolean | undefined;
  };

export abstract class LightCommand extends Command {}

export class SetLightOnCommand extends LightCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetLightOnCommand;
  }
}

export type LightEndpointCommand = SetLightOnCommand;
