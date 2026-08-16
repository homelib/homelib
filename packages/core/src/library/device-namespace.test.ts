import './device-namespace.js';

import {
  AirConditioner,
  Dehumidifier,
  Fan,
  Light,
  MotionSensor,
  PetFeeder,
  TemperatureHumiditySensor,
} from './devices/index.js';
import {getDeviceConstructor} from './registry.js';

test.each([
  ['airConditioner', AirConditioner],
  ['dehumidifier', Dehumidifier],
  ['fan', Fan],
  ['light', Light],
  ['motionSensor', MotionSensor],
  ['petFeeder', PetFeeder],
  ['temperatureHumiditySensor', TemperatureHumiditySensor],
])('registers the %s device constructor', (name, Constructor) => {
  expect(getDeviceConstructor(name)).toBe(Constructor);
});

test('does not retain the abbreviated air conditioner constructor', () => {
  expect(getDeviceConstructor('ac')).toBeUndefined();
});
