const CELSIUS_ZERO_IN_KELVIN = 273.15;
const CELSIUS_ZERO_IN_FAHRENHEIT = 32;
const FAHRENHEIT_PER_CELSIUS = 9 / 5;

export class Temperature {
  static fromKelvin(value: number): Temperature {
    const celsius = value - CELSIUS_ZERO_IN_KELVIN;

    return new Temperature(
      value,
      celsius,
      celsius * FAHRENHEIT_PER_CELSIUS + CELSIUS_ZERO_IN_FAHRENHEIT,
    );
  }

  static fromCelsius(value: number): Temperature {
    return new Temperature(
      value + CELSIUS_ZERO_IN_KELVIN,
      value,
      value * FAHRENHEIT_PER_CELSIUS + CELSIUS_ZERO_IN_FAHRENHEIT,
    );
  }

  static fromFahrenheit(value: number): Temperature {
    const celsius =
      (value - CELSIUS_ZERO_IN_FAHRENHEIT) / FAHRENHEIT_PER_CELSIUS;

    return new Temperature(celsius + CELSIUS_ZERO_IN_KELVIN, celsius, value);
  }

  get kelvin(): number {
    return this.valueInKelvin;
  }

  get celsius(): number {
    return this.valueInCelsius;
  }

  get fahrenheit(): number {
    return this.valueInFahrenheit;
  }

  private constructor(
    private readonly valueInKelvin: number,
    private readonly valueInCelsius: number,
    private readonly valueInFahrenheit: number,
  ) {
    if (!Number.isFinite(valueInKelvin) || valueInKelvin < 0) {
      throw new RangeError(
        'Temperature must be finite and at or above absolute zero.',
      );
    }

    Object.freeze(this);
  }

  toString(): string {
    return `${this.celsius} °C`;
  }
}
