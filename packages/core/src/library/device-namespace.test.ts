import './device-namespace.js';

import {AirConditioner, Dehumidifier, Fan, Light} from './devices/index.js';
import {getDeviceConstructor} from './registry.js';

test.each([
  ['ac', AirConditioner],
  ['dehumidifier', Dehumidifier],
  ['fan', Fan],
  ['light', Light],
])('registers the %s device constructor', (name, Constructor) => {
  expect(getDeviceConstructor(name)).toBe(Constructor);
});
