import {
  type AirConditioner,
  type Dehumidifier,
  type HumiditySensor,
  Temperature,
  type TemperatureSensor,
} from '@homelib/core';
import {reaction} from '@homelib/core/mobx';
import {
  StateMatcher,
  getTemperatureByApparentTemperatureAndRelativeHumidity,
} from '@homelib/utils';

const IDEAL_APPARENT_TEMPERATURE_UPPER_LIMIT = 27;
const IDEAL_APPARENT_TEMPERATURE_LOWER_LIMIT = 20;

// 很多垃圾空调到了指定温度后还会继续制冷，所以需要一个后退值。
const TEMPERATURE_BACKOFF = 4;

const IDEAL_RELATIVE_HUMIDITY_UPPER_LIMIT = 0.5;
const IDEAL_RELATIVE_HUMIDITY_LOWER_LIMIT = 0.45;

const IDEAL_TEMPERATURE_DEVIATION = 0.2;
const IDEAL_RELATIVE_HUMIDITY_DEVIATION = 0.02;

const SOFT_POWER_OFF_RELATIVE_HUMIDITY = 1;

export function setupTemperatureHumidityControl({
  temperatureSensor,
  humiditySensor,
  airConditioner,
  dehumidifier,
  onGetter = () => true,
}: {
  temperatureSensor: TemperatureSensor;
  humiditySensor: HumiditySensor;
  airConditioner: AirConditioner;
  dehumidifier: Dehumidifier;
  onGetter?: () => boolean | undefined;
}): void {
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

  const relativeHumidityMatcher = new StateMatcher<LevelState, number>([
    {
      state: 'high',
      enter: relativeHumidity =>
        relativeHumidity > IDEAL_RELATIVE_HUMIDITY_UPPER_LIMIT,
      leave: relativeHumidity =>
        relativeHumidity <=
        IDEAL_RELATIVE_HUMIDITY_UPPER_LIMIT - IDEAL_RELATIVE_HUMIDITY_DEVIATION,
    },
    {
      state: 'ideal',
      enter: relativeHumidity =>
        relativeHumidity <= IDEAL_RELATIVE_HUMIDITY_UPPER_LIMIT &&
        relativeHumidity >= IDEAL_RELATIVE_HUMIDITY_LOWER_LIMIT,
      leave: relativeHumidity =>
        relativeHumidity > IDEAL_RELATIVE_HUMIDITY_UPPER_LIMIT ||
        relativeHumidity < IDEAL_RELATIVE_HUMIDITY_LOWER_LIMIT,
    },
    {
      state: 'low',
      enter: relativeHumidity =>
        relativeHumidity < IDEAL_RELATIVE_HUMIDITY_LOWER_LIMIT,
      leave: relativeHumidity =>
        relativeHumidity >=
        IDEAL_RELATIVE_HUMIDITY_LOWER_LIMIT + IDEAL_RELATIVE_HUMIDITY_DEVIATION,
    },
  ]);

  reaction(
    () =>
      airConditioner.ready && dehumidifier.ready
        ? {
            temperature: temperatureSensor.temperature?.celsius,
            relativeHumidity: humiditySensor.relativeHumidity,
            on: onGetter(),
          }
        : {},
    ({temperature, relativeHumidity, on}) => {
      if (on === undefined) {
        return;
      }

      if (!on) {
        airConditioner.turnOff();
        dehumidifier.turnOff();
        return;
      }

      if (temperature === undefined || relativeHumidity === undefined) {
        return;
      }

      airConditioner.turnOn();
      dehumidifier.turnOn();

      const nextIdealTemperatureUpperLimit =
        getTemperatureByApparentTemperatureAndRelativeHumidity(
          IDEAL_APPARENT_TEMPERATURE_UPPER_LIMIT,
          relativeHumidity,
        );
      const nextIdealTemperatureLowerLimit =
        getTemperatureByApparentTemperatureAndRelativeHumidity(
          IDEAL_APPARENT_TEMPERATURE_LOWER_LIMIT,
          relativeHumidity,
        );

      idealTemperatureUpperLimit = nextIdealTemperatureUpperLimit;
      idealTemperatureLowerLimit = nextIdealTemperatureLowerLimit;

      console.info({
        temperature,
        relativeHumidity,
        idealTemperatureUpperLimit,
        idealTemperatureLowerLimit,
      });

      const temperatureState = temperatureMatcher.update(temperature);
      const relativeHumidityState =
        relativeHumidityMatcher.update(relativeHumidity);

      console.info({temperatureState, relativeHumidityState});

      if (
        temperatureState.state === 'high' &&
        relativeHumidityState.state === 'high'
      ) {
        airConditioner
          .setMode('dry')
          .setTargetHumidity(IDEAL_RELATIVE_HUMIDITY_UPPER_LIMIT);

        dehumidifier.setTargetHumidity(SOFT_POWER_OFF_RELATIVE_HUMIDITY);
      } else if (temperatureState.state === 'high') {
        airConditioner
          .setMode('cool')
          .setTargetTemperature(
            Temperature.fromCelsius(idealTemperatureUpperLimit),
          );
      } else if (relativeHumidityState.state === 'high') {
        airConditioner
          .setMode('cool')
          .setTargetTemperature(
            Temperature.fromCelsius(
              idealTemperatureUpperLimit + TEMPERATURE_BACKOFF,
            ),
          );

        dehumidifier.setTargetHumidity(IDEAL_RELATIVE_HUMIDITY_UPPER_LIMIT);
      } else if (
        temperatureState.state === 'low' &&
        relativeHumidityState.state === 'low'
      ) {
        airConditioner
          .setMode('heat')
          .setTargetTemperature(
            Temperature.fromCelsius(idealTemperatureLowerLimit),
          );

        dehumidifier.setTargetHumidity(SOFT_POWER_OFF_RELATIVE_HUMIDITY);
      } else if (temperatureState.state === 'low') {
        airConditioner
          .setMode('heat')
          .setTargetTemperature(
            Temperature.fromCelsius(idealTemperatureLowerLimit),
          );

        dehumidifier.setTargetHumidity(SOFT_POWER_OFF_RELATIVE_HUMIDITY);
      } else if (relativeHumidityState.state === 'low') {
        airConditioner
          .setMode('heat')
          .setTargetTemperature(
            Temperature.fromCelsius(
              idealTemperatureLowerLimit - TEMPERATURE_BACKOFF,
            ),
          );

        dehumidifier.setTargetHumidity(SOFT_POWER_OFF_RELATIVE_HUMIDITY);
      } else {
        switch (airConditioner.mode) {
          case 'dry':
            airConditioner.setTargetHumidity(
              IDEAL_RELATIVE_HUMIDITY_UPPER_LIMIT,
            );
            dehumidifier.setTargetHumidity(SOFT_POWER_OFF_RELATIVE_HUMIDITY);
            break;
          case 'cool':
            airConditioner.setTargetTemperature(
              Temperature.fromCelsius(
                idealTemperatureUpperLimit + TEMPERATURE_BACKOFF,
              ),
            );

            dehumidifier.setTargetHumidity(IDEAL_RELATIVE_HUMIDITY_UPPER_LIMIT);
            break;
          case 'heat':
            airConditioner.setTargetTemperature(
              Temperature.fromCelsius(
                idealTemperatureLowerLimit - TEMPERATURE_BACKOFF,
              ),
            );

            dehumidifier.setTargetHumidity(SOFT_POWER_OFF_RELATIVE_HUMIDITY);
            break;
        }
      }
    },
    {
      fireImmediately: true,
    },
  );
}
