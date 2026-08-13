import {
  getApparentTemperatureByTemperatureAndHumidity,
  getTemperatureByApparentTemperatureAndHumidity,
} from './apparent-temperature.js';

test('calculates apparent temperature from temperature and humidity', () => {
  expect(getApparentTemperatureByTemperatureAndHumidity(26, 0.55)).toBeCloseTo(
    28.10108642032524,
  );
});

test('handles zero humidity in both directions', () => {
  expect(getApparentTemperatureByTemperatureAndHumidity(26, 0)).toBe(22);
  expect(getTemperatureByApparentTemperatureAndHumidity(22, 0)).toBe(26);
});

test('calculates temperature from apparent temperature and humidity', () => {
  expect(getTemperatureByApparentTemperatureAndHumidity(26, 0.5)).toBeCloseTo(
    24.82735117871313,
  );
});

test.each([
  [5, 0.4],
  [20, 0.45],
  [26, 0.55],
  [30, 0.8],
  [40, 1],
])('round-trips temperature %p at humidity %p', (temperature, humidity) => {
  const apparentTemperature = getApparentTemperatureByTemperatureAndHumidity(
    temperature,
    humidity,
  );

  expect(
    getTemperatureByApparentTemperatureAndHumidity(
      apparentTemperature,
      humidity,
    ),
  ).toBeCloseTo(temperature, 8);
});
