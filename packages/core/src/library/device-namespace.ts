import {AirConditioner, Dehumidifier, Fan, Light} from './devices/index.js';
import {register} from './registry.js';

register({
  ac: AirConditioner,
  dehumidifier: Dehumidifier,
  fan: Fan,
  light: Light,
});

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface DeviceConstructors {
      ac: AirConditioner;
      dehumidifier: Dehumidifier;
      fan: Fan;
      light: Light;
    }
  }
}
