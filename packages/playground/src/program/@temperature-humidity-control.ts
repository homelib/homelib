import {
  type AirConditioner,
  type Dehumidifier,
  type RelativeHumiditySource,
  Temperature,
  type TemperatureSource,
  autorun,
} from '@homelib/core';
import {
  StateMatcher,
  getTemperatureByApparentTemperatureAndRelativeHumidity,
} from '@homelib/utils';
import _ from 'lodash';

const VERY_HIGH_TEMPERATURE_OFFSET = 2;

const COOL_MODE_FAN_SPEED_TEMPERATURE_DIFFERENCE = 4;
const HEAT_MODE_FAN_SPEED_TEMPERATURE_DIFFERENCE = 4;

// 很多垃圾空调到了指定温度后还会继续制冷，所以需要一个后退值。
const TEMPERATURE_BACKOFF = 4;

const SOFT_OFF_DEHUMIDIFIER_RELATIVE_HUMIDITY = 1;

export function setupTemperatureHumidityControl(
  name: string,
  {
    airConditioner,
    dehumidifier,
    onGetter = () => airConditioner.on,
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
      sensor: TemperatureSource;
      idealApparentTemperatureUpperLimit: number;
      idealApparentTemperatureLowerLimit: number;
      idealTemperatureTolerance: number;
    };
    humidity: {
      sensor: RelativeHumiditySource;
      idealRelativeHumidityUpperLimit: number;
      idealRelativeHumidityLowerLimit: number;
      idealRelativeHumidityTolerance: number;
    };
  },
): void {
  let idealTemperatureUpperLimit = idealApparentTemperatureUpperLimit;
  let idealTemperatureLowerLimit = idealApparentTemperatureLowerLimit;
  let idealTemperatureMiddle =
    (idealTemperatureLowerLimit + idealTemperatureUpperLimit) / 2;

  const temperatureMatcher = new StateMatcher<
    'very-high' | 'high' | 'ideal-high' | 'ideal-low' | 'low',
    number
  >([
    {
      state: 'very-high',
      enter: temperature =>
        temperature >=
        idealTemperatureUpperLimit + VERY_HIGH_TEMPERATURE_OFFSET,
      leave: temperature =>
        temperature <= idealTemperatureUpperLimit - idealTemperatureTolerance,
    },
    {
      state: 'high',
      enter: temperature => temperature >= idealTemperatureUpperLimit,
      leave: temperature =>
        temperature >
          idealTemperatureUpperLimit +
            VERY_HIGH_TEMPERATURE_OFFSET +
            idealTemperatureTolerance ||
        temperature < idealTemperatureUpperLimit - idealTemperatureTolerance,
    },
    {
      state: 'ideal-high',
      enter: temperature => temperature >= idealTemperatureMiddle,
      leave: temperature =>
        temperature > idealTemperatureUpperLimit + idealTemperatureTolerance ||
        temperature < idealTemperatureMiddle - idealTemperatureTolerance,
    },
    {
      state: 'ideal-low',
      enter: temperature => temperature >= idealTemperatureLowerLimit,
      leave: temperature =>
        temperature > idealTemperatureMiddle + idealTemperatureTolerance ||
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
    const dehumidifierWaterTankFull = dehumidifier.waterTankFull;

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
    idealTemperatureMiddle =
      (idealTemperatureLowerLimit + idealTemperatureUpperLimit) / 2;

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
      dehumidifierWaterTankFull,
    });

    const setAirConditionerDryMode = (): void => {
      airConditioner
        .setMode('dry')
        .setTargetRelativeHumidity(idealRelativeHumidityLowerLimit);
    };

    const setAirConditionerCoolMode = (targetTemperature: number): void => {
      airConditioner
        .setMode('cool')
        .setTargetTemperature(Temperature.fromCelsius(targetTemperature))
        .setFanSpeed(
          _.clamp(
            (temperature - idealTemperatureUpperLimit) /
              COOL_MODE_FAN_SPEED_TEMPERATURE_DIFFERENCE,
            0,
            1,
          ),
        );
    };

    const setAirConditionerHeatMode = (targetTemperature: number): void => {
      airConditioner
        .setMode('heat')
        .setTargetTemperature(Temperature.fromCelsius(targetTemperature))
        .setFanSpeed(
          _.clamp(
            (idealTemperatureLowerLimit - temperature) /
              HEAT_MODE_FAN_SPEED_TEMPERATURE_DIFFERENCE,
            0,
            1,
          ),
        );
    };

    const setDehumidifier = (targetRelativeHumidity: number): void => {
      if (dehumidifierWaterTankFull === true) {
        return;
      }

      dehumidifier.setTargetRelativeHumidity(targetRelativeHumidity);
    };

    switch (temperatureState.state) {
      case 'very-high':
        setAirConditionerCoolMode(idealTemperatureLowerLimit);

        switch (relativeHumidityState.state) {
          case 'high':
            setDehumidifier(idealRelativeHumidityLowerLimit);
            break;
          default:
            setDehumidifier(idealRelativeHumidityUpperLimit);
            break;
        }

        break;
      case 'high':
        switch (relativeHumidityState.state) {
          case 'high':
            setAirConditionerDryMode();
            break;
          default:
            setAirConditionerCoolMode(idealTemperatureLowerLimit);
            break;
        }

        setDehumidifier(idealRelativeHumidityUpperLimit);

        break;
      case 'ideal-high':
        setAirConditionerCoolMode(
          idealTemperatureUpperLimit + TEMPERATURE_BACKOFF,
        );

        switch (relativeHumidityState.state) {
          case 'high':
            setDehumidifier(idealRelativeHumidityLowerLimit);
            break;
          default:
            setDehumidifier(idealRelativeHumidityUpperLimit);
            break;
        }

        break;
      case 'ideal-low':
        setAirConditionerHeatMode(
          idealTemperatureLowerLimit - TEMPERATURE_BACKOFF,
        );

        switch (relativeHumidityState.state) {
          case 'high':
            setDehumidifier(idealRelativeHumidityLowerLimit);
            break;
          default:
            setDehumidifier(SOFT_OFF_DEHUMIDIFIER_RELATIVE_HUMIDITY);
            break;
        }

        break;
      case 'low':
        setAirConditionerHeatMode(idealTemperatureUpperLimit);

        switch (relativeHumidityState.state) {
          case 'high':
            setDehumidifier(idealRelativeHumidityLowerLimit);
            break;
          default:
            setDehumidifier(SOFT_OFF_DEHUMIDIFIER_RELATIVE_HUMIDITY);
            break;
        }

        break;
    }
  });
}
