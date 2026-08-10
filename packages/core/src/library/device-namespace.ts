import {Light} from './devices/index.js';
import {register} from './runtime/index.js';

register({
  light: Light,
});

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface DeviceConstructors {
      light: Light;
    }
  }
}
