import {
  type AirConditioner,
  type Dehumidifier,
  type HumiditySensor,
  Temperature,
  type TemperatureSensor,
} from '@homelib/core';
import {autorun} from '@homelib/core/mobx';
import {
  StateMatcher,
  getTemperatureByApparentTemperatureAndRelativeHumidity,
} from '@homelib/utils';

const TEMPERATURE_VERY_HIGH_OFFSET = 2;

// 很多垃圾空调到了指定温度后还会继续制冷，所以需要一个后退值。
const TEMPERATURE_BACKOFF = 4;

const SOFT_POWER_OFF_RELATIVE_HUMIDITY = 1;

export function setupTemperatureHumidityControl(
  name: string,
  {
    airConditioner,
    dehumidifier,
    onGetter = () => true,
    temperature: {
      sensor: temperatureSensor,
      idealApparentTemperatureUpperLimit,
      idealApparentTemperatureLowerLimit,
      idealTemperatureTolerance,
    },
    humidity: {
      sensor: humiditySensor,
      idealRelativeHumidityUpperLimit,
      idealRelativeHumidityLowerLimit,
      idealRelativeHumidityTolerance,
    },
  }: {
    airConditioner: AirConditioner;
    dehumidifier: Dehumidifier;
    onGetter?: () => boolean | undefined;
    temperature: {
      sensor: TemperatureSensor;
      idealApparentTemperatureUpperLimit: number;
      idealApparentTemperatureLowerLimit: number;
      idealTemperatureTolerance: number;
    };
    humidity: {
      sensor: HumiditySensor;
      idealRelativeHumidityUpperLimit: number;
      idealRelativeHumidityLowerLimit: number;
      idealRelativeHumidityTolerance: number;
    };
  },
): void {
  let idealTemperatureUpperLimit = idealApparentTemperatureUpperLimit;
  let idealTemperatureLowerLimit = idealApparentTemperatureLowerLimit;

  const temperatureMatcher = new StateMatcher<
    'very-high' | 'high' | 'ideal' | 'low',
    number
  >([
    {
      state: 'very-high',
      enter: temperature =>
        temperature >=
        idealTemperatureUpperLimit + TEMPERATURE_VERY_HIGH_OFFSET,
      leave: temperature =>
        temperature <= idealTemperatureUpperLimit - idealTemperatureTolerance,
    },
    {
      state: 'high',
      enter: temperature => temperature >= idealTemperatureUpperLimit,
      leave: temperature =>
        temperature >
          idealTemperatureUpperLimit +
            TEMPERATURE_VERY_HIGH_OFFSET +
            idealTemperatureTolerance ||
        temperature < idealTemperatureUpperLimit - idealTemperatureTolerance,
    },
    {
      state: 'ideal',
      enter: temperature => temperature >= idealTemperatureLowerLimit,
      leave: temperature =>
        temperature > idealTemperatureUpperLimit + idealTemperatureTolerance ||
        temperature < idealTemperatureLowerLimit - idealTemperatureTolerance,
    },
    {
      state: 'low',
      enter: _temperature => true,
      leave: temperature =>
        temperature > idealTemperatureLowerLimit + idealTemperatureTolerance,
    },
  ]);

  const relativeHumidityMatcher = new StateMatcher<
    'high' | 'ideal' | 'low',
    number
  >([
    {
      state: 'high',
      enter: relativeHumidity =>
        relativeHumidity >= idealRelativeHumidityUpperLimit,
      leave: relativeHumidity =>
        relativeHumidity <
        idealRelativeHumidityUpperLimit - idealRelativeHumidityTolerance,
    },
    {
      state: 'ideal',
      enter: relativeHumidity =>
        relativeHumidity >= idealRelativeHumidityLowerLimit,
      leave: relativeHumidity =>
        relativeHumidity >
          idealRelativeHumidityUpperLimit + idealRelativeHumidityTolerance ||
        relativeHumidity <
          idealRelativeHumidityLowerLimit - idealRelativeHumidityTolerance,
    },
    {
      state: 'low',
      enter: _relativeHumidity => true,
      leave: relativeHumidity =>
        relativeHumidity >
        idealRelativeHumidityLowerLimit + idealRelativeHumidityTolerance,
    },
  ]);

  autorun(() => {
    if (
      !airConditioner.ready ||
      !dehumidifier.ready ||
      !temperatureSensor.ready ||
      !humiditySensor.ready
    ) {
      return;
    }

    const on = onGetter();

    if (on === undefined) {
      return;
    }

    if (!on) {
      airConditioner.turnOff();
      dehumidifier.turnOff();
      return;
    }

    const temperature = temperatureSensor.temperature?.celsius;
    const relativeHumidity = humiditySensor.relativeHumidity;

    if (temperature === undefined || relativeHumidity === undefined) {
      return;
    }

    airConditioner.turnOn();
    dehumidifier.turnOn();

    const nextIdealTemperatureUpperLimit =
      getTemperatureByApparentTemperatureAndRelativeHumidity(
        idealApparentTemperatureUpperLimit,
        relativeHumidity,
      );
    const nextIdealTemperatureLowerLimit =
      getTemperatureByApparentTemperatureAndRelativeHumidity(
        idealApparentTemperatureLowerLimit,
        relativeHumidity,
      );

    idealTemperatureUpperLimit = nextIdealTemperatureUpperLimit;
    idealTemperatureLowerLimit = nextIdealTemperatureLowerLimit;

    const temperatureState = temperatureMatcher.update(temperature);
    const relativeHumidityState =
      relativeHumidityMatcher.update(relativeHumidity);

    console.info(name, {
      temperature,
      relativeHumidity,
      idealTemperatureUpperLimit,
      idealTemperatureLowerLimit,
      temperatureState,
      relativeHumidityState,
    });

    if (
      (temperatureState.state === 'high' ||
        temperatureState.state === 'very-high') &&
      relativeHumidityState.state === 'high'
    ) {
      if (temperatureState.state === 'very-high') {
        airConditioner
          .setMode('cool')
          .setTargetTemperature(
            Temperature.fromCelsius(idealTemperatureUpperLimit),
          );
      } else {
        airConditioner
          .setMode('dry')
          .setTargetHumidity(idealRelativeHumidityUpperLimit);
      }

      dehumidifier.setTargetHumidity(SOFT_POWER_OFF_RELATIVE_HUMIDITY);
    } else if (
      temperatureState.state === 'high' ||
      temperatureState.state === 'very-high'
    ) {
      airConditioner
        .setMode('cool')
        .setTargetTemperature(
          Temperature.fromCelsius(idealTemperatureUpperLimit),
        );

      dehumidifier.setTargetHumidity(idealRelativeHumidityUpperLimit);
    } else if (relativeHumidityState.state === 'high') {
      airConditioner
        .setMode('cool')
        .setTargetTemperature(
          Temperature.fromCelsius(
            idealTemperatureUpperLimit + TEMPERATURE_BACKOFF,
          ),
        );

      dehumidifier.setTargetHumidity(idealRelativeHumidityUpperLimit);
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
        case 'cool':
          airConditioner
            .setMode('cool')
            .setTargetTemperature(
              Temperature.fromCelsius(
                idealTemperatureUpperLimit + TEMPERATURE_BACKOFF,
              ),
            );

          dehumidifier.setTargetHumidity(idealRelativeHumidityUpperLimit);

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
  });
}
