import {
  type AirConditioner,
  type Dehumidifier,
  Temperature,
} from '@homelib/core';
import {reaction} from '@homelib/core/mobx';
import {
  StateMatcher,
  getTemperatureByApparentTemperatureAndHumidity,
} from '@homelib/utils';

const IDEAL_APPARENT_TEMPERATURE_UPPER_LIMIT = 26;
const IDEAL_APPARENT_TEMPERATURE_LOWER_LIMIT = 20;

// 很多垃圾空调到了指定温度后还会继续制冷，所以需要一个后退值。
const TEMPERATURE_BACKOFF = 2;

const IDEAL_HUMIDITY_UPPER_LIMIT = 0.5;
const IDEAL_HUMIDITY_LOWER_LIMIT = 0.45;

const IDEAL_TEMPERATURE_DEVIATION = 0.5;
const IDEAL_HUMIDITY_DEVIATION = 0.02;

const SOFT_POWER_OFF_HUMIDITY = 1;

export function setupTemperatureHumidityControl(
  airConditioner: AirConditioner,
  dehumidifier: Dehumidifier,
): void {
  type LevelState = 'high' | 'ideal' | 'low';

  let idealTemperatureUpperLimit = IDEAL_APPARENT_TEMPERATURE_UPPER_LIMIT;
  let idealTemperatureLowerLimit = IDEAL_APPARENT_TEMPERATURE_LOWER_LIMIT;

  const temperatureMatcher = new StateMatcher<LevelState, number>([
    {
      state: 'high',
      enter: temperature => temperature > idealTemperatureUpperLimit,
      leave: temperature =>
        temperature <= idealTemperatureUpperLimit - IDEAL_TEMPERATURE_DEVIATION,
    },
    {
      state: 'ideal',
      enter: temperature =>
        temperature <= idealTemperatureUpperLimit &&
        temperature >= idealTemperatureLowerLimit,
      leave: temperature =>
        temperature > idealTemperatureUpperLimit ||
        temperature < idealTemperatureLowerLimit,
    },
    {
      state: 'low',
      enter: temperature => temperature < idealTemperatureLowerLimit,
      leave: temperature =>
        temperature >= idealTemperatureLowerLimit + IDEAL_TEMPERATURE_DEVIATION,
    },
  ]);

  const humidityMatcher = new StateMatcher<LevelState, number>([
    {
      state: 'high',
      enter: humidity => humidity > IDEAL_HUMIDITY_UPPER_LIMIT,
      leave: humidity =>
        humidity <= IDEAL_HUMIDITY_UPPER_LIMIT - IDEAL_HUMIDITY_DEVIATION,
    },
    {
      state: 'ideal',
      enter: humidity =>
        humidity <= IDEAL_HUMIDITY_UPPER_LIMIT &&
        humidity >= IDEAL_HUMIDITY_LOWER_LIMIT,
      leave: humidity =>
        humidity > IDEAL_HUMIDITY_UPPER_LIMIT ||
        humidity < IDEAL_HUMIDITY_LOWER_LIMIT,
    },
    {
      state: 'low',
      enter: humidity => humidity < IDEAL_HUMIDITY_LOWER_LIMIT,
      leave: humidity =>
        humidity >= IDEAL_HUMIDITY_LOWER_LIMIT + IDEAL_HUMIDITY_DEVIATION,
    },
  ]);

  reaction(
    () =>
      airConditioner.ready && dehumidifier.ready
        ? {
            temperature: dehumidifier.temperature?.celsius,
            humidity: dehumidifier.humidity,
          }
        : {},
    ({temperature, humidity}) => {
      if (temperature === undefined || humidity === undefined) {
        return;
      }

      const nextIdealTemperatureUpperLimit =
        getTemperatureByApparentTemperatureAndHumidity(
          IDEAL_APPARENT_TEMPERATURE_UPPER_LIMIT,
          humidity,
        );
      const nextIdealTemperatureLowerLimit =
        getTemperatureByApparentTemperatureAndHumidity(
          IDEAL_APPARENT_TEMPERATURE_LOWER_LIMIT,
          humidity,
        );

      const idealTemperatureLimitsChanged =
        Math.abs(nextIdealTemperatureUpperLimit - idealTemperatureUpperLimit) >
          IDEAL_TEMPERATURE_DEVIATION ||
        Math.abs(nextIdealTemperatureLowerLimit - idealTemperatureLowerLimit) >
          IDEAL_TEMPERATURE_DEVIATION;

      idealTemperatureUpperLimit = nextIdealTemperatureUpperLimit;
      idealTemperatureLowerLimit = nextIdealTemperatureLowerLimit;

      console.info({
        temperature,
        humidity,
        idealTemperatureUpperLimit,
        idealTemperatureLowerLimit,
      });

      const temperatureState = temperatureMatcher.update(temperature);
      const humidityState = humidityMatcher.update(humidity);

      if (
        !temperatureState.changed &&
        !humidityState.changed &&
        !idealTemperatureLimitsChanged
      ) {
        return;
      }

      console.info({temperatureState, humidityState});

      if (temperatureState.state === 'high' && humidityState.state === 'high') {
        airConditioner
          .ensureOn()
          .setMode('dry')
          .setTargetHumidity(IDEAL_HUMIDITY_UPPER_LIMIT);

        dehumidifier.ensureOn().setTargetHumidity(SOFT_POWER_OFF_HUMIDITY);
      } else if (temperatureState.state === 'high') {
        airConditioner
          .ensureOn()
          .setMode('cool')
          .setTargetTemperature(
            Temperature.fromCelsius(idealTemperatureUpperLimit),
          );
      } else if (humidityState.state === 'high') {
        airConditioner
          .ensureOn()
          .setMode('cool')
          .setTargetTemperature(
            Temperature.fromCelsius(
              idealTemperatureUpperLimit + TEMPERATURE_BACKOFF,
            ),
          );

        dehumidifier.ensureOn().setTargetHumidity(IDEAL_HUMIDITY_UPPER_LIMIT);
      } else if (
        temperatureState.state === 'low' &&
        humidityState.state === 'low'
      ) {
        airConditioner
          .ensureOn()
          .setMode('heat')
          .setTargetTemperature(
            Temperature.fromCelsius(idealTemperatureLowerLimit),
          );

        dehumidifier.ensureOn().setTargetHumidity(SOFT_POWER_OFF_HUMIDITY);
      } else if (temperatureState.state === 'low') {
        airConditioner
          .ensureOn()
          .setMode('heat')
          .setTargetTemperature(
            Temperature.fromCelsius(idealTemperatureLowerLimit),
          );

        dehumidifier.ensureOn().setTargetHumidity(SOFT_POWER_OFF_HUMIDITY);
      } else if (humidityState.state === 'low') {
        airConditioner
          .ensureOn()
          .setMode('heat')
          .setTargetTemperature(
            Temperature.fromCelsius(
              idealTemperatureLowerLimit - TEMPERATURE_BACKOFF,
            ),
          );

        dehumidifier.ensureOn().setTargetHumidity(SOFT_POWER_OFF_HUMIDITY);
      } else {
        switch (airConditioner.mode) {
          case 'dry':
            airConditioner
              .ensureOn()
              .setTargetHumidity(IDEAL_HUMIDITY_UPPER_LIMIT);
            dehumidifier.ensureOn().setTargetHumidity(SOFT_POWER_OFF_HUMIDITY);
            break;
          case 'cool':
            airConditioner
              .ensureOn()
              .setTargetTemperature(
                Temperature.fromCelsius(
                  idealTemperatureUpperLimit + TEMPERATURE_BACKOFF,
                ),
              );

            dehumidifier
              .ensureOn()
              .setTargetHumidity(IDEAL_HUMIDITY_UPPER_LIMIT);
            break;
          case 'heat':
            airConditioner
              .ensureOn()
              .setTargetTemperature(
                Temperature.fromCelsius(
                  idealTemperatureLowerLimit - TEMPERATURE_BACKOFF,
                ),
              );

            dehumidifier.ensureOn().setTargetHumidity(SOFT_POWER_OFF_HUMIDITY);
            break;
        }
      }
    },
    {
      fireImmediately: true,
    },
  );
}
