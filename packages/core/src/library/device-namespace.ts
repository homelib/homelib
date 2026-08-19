import {
  AirConditioner,
  BathHeater,
  Dehumidifier,
  Fan,
  Light,
  MotionAmbientLightLevelSensor,
  MotionSensor,
  PetFeeder,
  SmartSpeaker,
  Switch,
  TemperatureHumiditySensor,
} from './devices/index.js';
import {register} from './registry.js';

register({
  airConditioner: AirConditioner,
  bathHeater: BathHeater,
  dehumidifier: Dehumidifier,
  fan: Fan,
  light: Light,
  motionAmbientLightLevelSensor: MotionAmbientLightLevelSensor,
  motionSensor: MotionSensor,
  petFeeder: PetFeeder,
  smartSpeaker: SmartSpeaker,
  switch: Switch,
  temperatureHumiditySensor: TemperatureHumiditySensor,
});

declare global {
  namespace Home {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface DeviceConstructors {
      airConditioner: AirConditioner;
      bathHeater: BathHeater;
      dehumidifier: Dehumidifier;
      fan: Fan;
      light: Light;
      motionAmbientLightLevelSensor: MotionAmbientLightLevelSensor;
      motionSensor: MotionSensor;
      petFeeder: PetFeeder;
      smartSpeaker: SmartSpeaker;
      switch: Switch;
      temperatureHumiditySensor: TemperatureHumiditySensor;
    }
  }
}
