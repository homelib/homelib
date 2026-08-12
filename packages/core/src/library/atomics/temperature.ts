const CELSIUS_ZERO_IN_KELVIN = 273.15;
const CELSIUS_ZERO_IN_FAHRENHEIT = 32;
const FAHRENHEIT_PER_CELSIUS = 9 / 5;

export class Temperature {
  static fromKelvin(value: number): Temperature {
    return new Temperature(value);
  }

  static fromCelsius(value: number): Temperature {
    return new Temperature(value + CELSIUS_ZERO_IN_KELVIN);
  }

  static fromFahrenheit(value: number): Temperature {
    return new Temperature(
      (value - CELSIUS_ZERO_IN_FAHRENHEIT) / FAHRENHEIT_PER_CELSIUS +
        CELSIUS_ZERO_IN_KELVIN,
    );
  }

  get kelvin(): number {
    return this.valueInKelvin;
  }

  get celsius(): number {
    return this.valueInKelvin - CELSIUS_ZERO_IN_KELVIN;
  }

  get fahrenheit(): number {
    return this.celsius * FAHRENHEIT_PER_CELSIUS + CELSIUS_ZERO_IN_FAHRENHEIT;
  }

  private constructor(private readonly valueInKelvin: number) {
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
