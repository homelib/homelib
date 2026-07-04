import {Device} from '../device.js';

export abstract class Light<TCommand> extends Device<TCommand> {
  abstract turnOn(): void;
  abstract turnOff(): void;
}

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface DeviceConstructors {
      light: Light<unknown>;
    }
  }
}
