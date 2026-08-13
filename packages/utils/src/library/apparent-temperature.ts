const APPARENT_TEMPERATURE_OFFSET = 4;
const VAPOR_PRESSURE_FACTOR = 2.01696;
const SATURATION_EXPONENT_FACTOR = 17.67;
const SATURATION_TEMPERATURE_OFFSET = 243.5;

/**
 * Calculates apparent temperature in degrees Celsius from air temperature in
 * degrees Celsius and relative humidity as a normalized ratio from 0 to 1.
 * Inputs are expected to be finite numbers within the formula's physical
 * domain.
 *
 * Uses `AT = T - 4 + 2.01696 × RH × exp(17.67 × T / (T + 243.5))`.
 */
export function getApparentTemperatureByTemperatureAndRelativeHumidity(
  temperature: number,
  relativeHumidity: number,
): number {
  return (
    temperature -
    APPARENT_TEMPERATURE_OFFSET +
    VAPOR_PRESSURE_FACTOR *
      relativeHumidity *
      Math.exp(
        (SATURATION_EXPONENT_FACTOR * temperature) /
          (temperature + SATURATION_TEMPERATURE_OFFSET),
      )
  );
}

/**
 * Calculates air temperature in degrees Celsius from apparent temperature in
 * degrees Celsius and relative humidity as a normalized ratio from 0 to 1.
 * Inputs are expected to be finite numbers within the formula's physical
 * domain.
 *
 * Solves the apparent-temperature formula using Newton's method.
 */
export function getTemperatureByApparentTemperatureAndRelativeHumidity(
  apparentTemperature: number,
  relativeHumidity: number,
): number {
  if (relativeHumidity <= 1e-12) {
    return apparentTemperature + APPARENT_TEMPERATURE_OFFSET;
  }

  let temperature: number;

  if (apparentTemperature > 30) {
    temperature = apparentTemperature + 2.5;
  } else if (apparentTemperature > 10) {
    temperature = apparentTemperature + APPARENT_TEMPERATURE_OFFSET;
  } else {
    temperature = Math.max(apparentTemperature + 5, 5);
  }

  const derivativeFactor =
    SATURATION_EXPONENT_FACTOR * SATURATION_TEMPERATURE_OFFSET;

  for (let iteration = 0; iteration < 200; iteration++) {
    const exponent =
      (SATURATION_EXPONENT_FACTOR * temperature) /
      (temperature + SATURATION_TEMPERATURE_OFFSET);
    const exponentValue = Math.exp(exponent);
    const difference =
      temperature -
      APPARENT_TEMPERATURE_OFFSET -
      apparentTemperature +
      VAPOR_PRESSURE_FACTOR * relativeHumidity * exponentValue;

    if (Math.abs(difference) < 1e-9) {
      return temperature;
    }

    const denominator = temperature + SATURATION_TEMPERATURE_OFFSET;
    const derivative =
      1 +
      (VAPOR_PRESSURE_FACTOR *
        relativeHumidity *
        exponentValue *
        derivativeFactor) /
        (denominator * denominator);

    if (Math.abs(derivative) < 1e-15) {
      break;
    }

    const nextTemperature = temperature - difference / derivative;

    if (nextTemperature < -273.15) {
      temperature = -273.15 + 1e-6;
    } else {
      temperature = nextTemperature;
    }
  }

  return temperature;
}
