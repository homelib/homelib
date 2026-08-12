import {computed} from 'mobx';

import {Command} from '../command.js';
import {Device, type DeviceEntry} from '../device.js';
import {Endpoint, type EndpointConnection} from '../endpoint.js';

export class Dehumidifier extends Device {
  protected readonly endpoint: DehumidifierEndpoint;

  @computed
  get on(): boolean | undefined {
    return this.endpoint.on;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(DehumidifierEndpoint);
  }

  turnOn(): void {
    this.endpoint.turnOn();
  }

  turnOff(): void {
    this.endpoint.turnOff();
  }
}

export class DehumidifierEndpoint<
  TConnection extends DehumidifierEndpointConnection =
    DehumidifierEndpointConnection,
> extends Endpoint<DehumidifierEndpointCommand, TConnection> {
  @computed
  get on(): boolean | undefined {
    return this.connection?.on;
  }

  turnOn(): void {
    this.enqueueCommand(new SetDehumidifierOnCommand(true));
  }

  turnOff(): void {
    this.enqueueCommand(new SetDehumidifierOnCommand(false));
  }
}

export type DehumidifierEndpointConnection =
  EndpointConnection<DehumidifierEndpointCommand> & {
    readonly on: boolean | undefined;
  };

export abstract class DehumidifierCommand extends Command {}

export class SetDehumidifierOnCommand extends DehumidifierCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof SetDehumidifierOnCommand;
  }
}

export type DehumidifierEndpointCommand = SetDehumidifierOnCommand;
