import {computed} from 'mobx';

import {StatefulCommand} from '../command.js';
import {Device, type DeviceEntry} from '../device.js';
import {
  Endpoint,
  type EndpointConnection,
  type EndpointLogState,
} from '../endpoint.js';

/** A stateful on/off control for a load or function. */
export class Switch extends Device {
  protected readonly endpoint: SwitchEndpoint;

  @computed
  get on(): boolean {
    return this.endpoint.on;
  }

  constructor(entry: DeviceEntry) {
    super(entry);
    this.endpoint = this.getOrCreateEndpoint(SwitchEndpoint);
  }

  turnOn(): this {
    this.endpoint.turnOn();
    return this;
  }

  turnOff(): this {
    this.endpoint.turnOff();
    return this;
  }
}

export class SwitchEndpoint<
  TConnection extends SwitchEndpointConnection = SwitchEndpointConnection,
> extends Endpoint<SwitchEndpointCommand, TConnection> {
  @computed
  get on(): boolean {
    return this.connection?.on ?? false;
  }

  protected override get logState(): EndpointLogState {
    return this.ready ? {ready: true, on: this.on} : {ready: false};
  }

  turnOn(): this {
    return this.enqueueCommand(new SetSwitchOnCommand(true));
  }

  turnOff(): this {
    return this.enqueueCommand(new SetSwitchOnCommand(false));
  }
}

export type SwitchEndpointConnection =
  EndpointConnection<SwitchEndpointCommand> & {
    readonly on: boolean;
  };

export class SetSwitchOnCommand extends StatefulCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override toLogString(): string {
    return `set on=${this.value}`;
  }
}

export type SwitchEndpointCommand = SetSwitchOnCommand;
