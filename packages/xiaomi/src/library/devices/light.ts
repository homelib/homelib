import {type Command, Light, LightEndpoint} from '@homelib/core';

import {MiotCommand} from '../command.js';
import type {MiotEndpointConnection} from '../endpoint-connection.js';

export class MiotLight extends Light<MiotLightEndpoint> {}

export class MiotLightEndpoint extends LightEndpoint<
  MiotCommand,
  MiotEndpointConnection
> {
  override turnOn(): void {
    this.enqueueCommand(new MiotSetLightOnCommand(true));
  }

  override turnOff(): void {
    this.enqueueCommand(new MiotSetLightOnCommand(false));
  }
}

export class MiotSetLightOnCommand extends MiotCommand {
  constructor(readonly value: boolean) {
    super();
  }

  override supersedes(command: Command): boolean {
    return command instanceof MiotSetLightOnCommand;
  }
}

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface MiotDeviceConstructors {
      light: MiotLight;
    }
  }
}
