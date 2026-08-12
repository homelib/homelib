import {Temperature} from './sensor.js';

test('converts between Kelvin, Celsius, and Fahrenheit', () => {
  const fromKelvin = Temperature.fromKelvin(300);
  const fromCelsius = Temperature.fromCelsius(25);
  const fromFahrenheit = Temperature.fromFahrenheit(68);

  expect(fromKelvin.kelvin).toBe(300);
  expect(fromKelvin.celsius).toBeCloseTo(26.85);
  expect(fromKelvin.fahrenheit).toBeCloseTo(80.33);
  expect(fromCelsius.kelvin).toBeCloseTo(298.15);
  expect(fromFahrenheit.celsius).toBeCloseTo(20);
  expect(fromFahrenheit.kelvin).toBeCloseTo(293.15);
});

test('accepts absolute zero', () => {
  expect(Temperature.fromKelvin(0).kelvin).toBe(0);
  expect(Temperature.fromCelsius(-273.15).kelvin).toBe(0);
  expect(Temperature.fromFahrenheit(-459.67).kelvin).toBe(0);
});

test.each([
  ['non-finite Kelvin', () => Temperature.fromKelvin(Number.NaN)],
  ['negative Kelvin', () => Temperature.fromKelvin(-0.1)],
  ['non-finite Celsius', () => Temperature.fromCelsius(Infinity)],
  ['below absolute zero Celsius', () => Temperature.fromCelsius(-273.16)],
  ['non-finite Fahrenheit', () => Temperature.fromFahrenheit(-Infinity)],
  ['below absolute zero Fahrenheit', () => Temperature.fromFahrenheit(-459.68)],
])('rejects %s', (_description, createTemperature) => {
  expect(createTemperature).toThrow(RangeError);
});

test('formats in Celsius', () => {
  const fromKelvin = Temperature.fromKelvin(273.15);

  expect(fromKelvin.toString()).toBe('0 °C');
});
