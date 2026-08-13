import {
  getApparentTemperatureByTemperatureAndRelativeHumidity,
  getTemperatureByApparentTemperatureAndRelativeHumidity,
} from './apparent-temperature.js';

test('calculates apparent temperature from temperature and relative humidity', () => {
  expect(
    getApparentTemperatureByTemperatureAndRelativeHumidity(26, 0.55),
  ).toBeCloseTo(28.10108642032524);
});

test('handles zero relative humidity in both directions', () => {
  expect(getApparentTemperatureByTemperatureAndRelativeHumidity(26, 0)).toBe(
    22,
  );
  expect(getTemperatureByApparentTemperatureAndRelativeHumidity(22, 0)).toBe(
    26,
  );
});

test('calculates temperature from apparent temperature and relative humidity', () => {
  expect(
    getTemperatureByApparentTemperatureAndRelativeHumidity(26, 0.5),
  ).toBeCloseTo(24.82735117871313);
});

test.each([
  [5, 0.4],
  [20, 0.45],
  [26, 0.55],
  [30, 0.8],
  [40, 1],
])(
  'round-trips temperature %p at relative humidity %p',
  (temperature, relativeHumidity) => {
    const apparentTemperature =
      getApparentTemperatureByTemperatureAndRelativeHumidity(
        temperature,
        relativeHumidity,
      );

    expect(
      getTemperatureByApparentTemperatureAndRelativeHumidity(
        apparentTemperature,
        relativeHumidity,
      ),
    ).toBeCloseTo(temperature, 8);
  },
);
