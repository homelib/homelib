import {Light, LightEndpoint} from '@homelib/core';

import {type MiotCommand, MiotSetPropertyCommand} from '../command.js';

export class MiotLight extends Light<MiotLightEndpoint> {}

export class MiotLightEndpoint extends LightEndpoint<MiotCommand> {
  override turnOn(): void {
    this.enqueueCommand(new MiotSetLightOnCommand(true));
  }

  override turnOff(): void {
    this.enqueueCommand(new MiotSetLightOnCommand(false));
  }
}

export class MiotSetLightOnCommand extends MiotSetPropertyCommand {
  constructor(value: boolean) {
    super({siid: 2, piid: 1}, value);
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
