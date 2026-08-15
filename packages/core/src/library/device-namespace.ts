import {
  AirConditioner,
  Dehumidifier,
  Fan,
  Light,
  TemperatureHumiditySensor,
} from './devices/index.js';
import {register} from './registry.js';

register({
  airConditioner: AirConditioner,
  dehumidifier: Dehumidifier,
  fan: Fan,
  light: Light,
  temperatureHumiditySensor: TemperatureHumiditySensor,
});

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface DeviceConstructors {
      airConditioner: AirConditioner;
      dehumidifier: Dehumidifier;
      fan: Fan;
      light: Light;
      temperatureHumiditySensor: TemperatureHumiditySensor;
    }
  }
}
