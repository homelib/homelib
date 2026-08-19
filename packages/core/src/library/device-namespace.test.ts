import './device-namespace.js';

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
import {getDeviceConstructor} from './registry.js';

test.each([
  ['airConditioner', AirConditioner],
  ['bathHeater', BathHeater],
  ['dehumidifier', Dehumidifier],
  ['fan', Fan],
  ['light', Light],
  ['motionAmbientLightLevelSensor', MotionAmbientLightLevelSensor],
  ['motionSensor', MotionSensor],
  ['petFeeder', PetFeeder],
  ['smartSpeaker', SmartSpeaker],
  ['switch', Switch],
  ['temperatureHumiditySensor', TemperatureHumiditySensor],
])('registers the %s device constructor', (name, Constructor) => {
  expect(getDeviceConstructor(name)).toBe(Constructor);
});

test('does not retain the abbreviated air conditioner constructor', () => {
  expect(getDeviceConstructor('ac')).toBeUndefined();
});
