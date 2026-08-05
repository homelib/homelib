import type {Command} from '../command.js';
import {Device} from '../device.js';
import {Endpoint} from '../endpoint.js';

export class Light<
  TEndpoint extends LightEndpoint = LightEndpoint,
> extends Device {
  constructor(protected readonly endpoint: TEndpoint) {
    super();
    this.registerEndpoint(endpoint);
  }

  turnOn(): void {
    this.endpoint.turnOn();
  }

  turnOff(): void {
    this.endpoint.turnOff();
  }
}

export abstract class LightEndpoint<
  TCommand extends Command = Command,
> extends Endpoint<TCommand> {
  abstract turnOn(): void;
  abstract turnOff(): void;
}

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface DeviceConstructors {
      light: Light;
    }
  }
}
